import { defineStore } from 'pinia';
import wsClient from '@/utils/socket';
import { useContactsStore } from '@/store/contacts';

/**
 * 音视频通话状态机（仅私聊）
 * 流程：发起方 getUserMedia → CALL_INVITE → 对方振铃 → 对方 ACCEPT 后
 * 发起方发 SDP offer → 应答方 answer → 双方 trickle ICE → connected
 * 任何一方 HANGUP/CANCEL/REJECT 或超时 → 双方 cleanup
 */
export const useCallStore = defineStore('call', {
  state: () => ({
    status: 'idle', // idle | outgoing | incoming | connected
    media: 'video', // video | audio
    callId: '',
    peerId: '',
    peerInfo: {}, // { nickname, username, avatar }
    localStream: null,
    remoteStream: null,
    connState: '', // RTCPeerConnection.connectionState
    muted: false,
    cameraOff: false,
    startedAt: 0
  }),

  getters: {
    isActive: (state) => state.status !== 'idle',
    isVideo: (state) => state.media === 'video'
  },

  actions: {
    // ---------- 发起 ----------
    async startCall(peerId, peerInfo, media = 'video') {
      if (this.isActive) {
        uni.showToast({ title: '当前正在通话中', icon: 'none' });
        return;
      }
      this.$patch({
        status: 'outgoing',
        media,
        callId: 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        peerId,
        peerInfo: peerInfo || {},
        connState: '',
        muted: false,
        cameraOff: false,
        startedAt: 0
      });

      // 先取本地媒体（失败则取消并提示）
      const stream = await this._getLocalStream(media);
      if (!stream) {
        this._cleanup();
        return;
      }

      this._newPeer();
      stream.getTracks().forEach(t => this._pc.addTrack(t, stream));

      this._sendSignal('CALL_INVITE', { to: peerId, callId: this.callId, media });
      this._startRing('outgoing');
      this._requestWakeLock(); // 通话期间屏幕常亮

      // 45s 无应答自动取消
      this._ringTimer = setTimeout(() => {
        if (this.status === 'outgoing') {
          this._sendSignal('CALL_CANCEL', { to: this.peerId, callId: this.callId });
          uni.showToast({ title: '对方无应答', icon: 'none' });
          this._cleanup();
        }
      }, 45000);
    },

    // ---------- 接听 ----------
    async acceptCall() {
      if (this.status !== 'incoming') return;
      clearTimeout(this._ringTimer);
      this._stopRing();
      const stream = await this._getLocalStream(this.media);
      if (!stream) {
        wsClient.send('CALL_REJECT', { to: this.peerId, callId: this.callId });
        this._cleanup();
        return;
      }
      this._sendSignal('CALL_ACCEPT', { to: this.peerId, callId: this.callId });
      // 进入"正在连接"展示态（connState 连上后文案切为计时）
      this.status = 'connected';
      this.startedAt = 0;
      this._newPeer();
      stream.getTracks().forEach(t => this._pc.addTrack(t, stream));
      // 应答方在收到 offer 的 CALL_SDP 时完成协商
    },

    // ---------- 拒绝 / 挂断 / 取消 ----------
    rejectCall() {
      this._sendSignal('CALL_REJECT', { to: this.peerId, callId: this.callId });
      this._cleanup();
    },

    hangup() {
      if (this.callId) {
        const type = this.status === 'incoming' ? 'CALL_CANCEL' : 'CALL_HANGUP';
        this._sendSignal(type, { to: this.peerId, callId: this.callId });
      }
      this._cleanup();
    },

    /**
     * 信令发送（带重试）：WS 抖动的瞬间发信令会静默丢失，
     * 导致对端状态卡死（如来电取消未送达、对端一直振铃），故失败后短暂重试
     */
    _sendSignal(type, data, attempt = 0) {
      const sent = wsClient.send(type, data);
      if (!sent && attempt < 2) {
        setTimeout(() => this._sendSignal(type, data, attempt + 1), 400);
      }
    },

    toggleMute() {
      this.muted = !this.muted;
      this.localStream && this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
    },

    toggleCamera() {
      this.cameraOff = !this.cameraOff;
      this.localStream && this.localStream.getVideoTracks().forEach(t => { t.enabled = !this.cameraOff; });
    },

    /**
     * 注册通话信令处理器：App.vue 启动（已登录）与用户登录后各调用一次；
     * wsClient.disconnect 会清空处理器，因此两处注册不会叠加
     */
    registerCallHandlers() {
      ['CALL_INVITE', 'CALL_ACCEPT', 'CALL_REJECT', 'CALL_CANCEL', 'CALL_HANGUP', 'CALL_SDP', 'CALL_ICE', 'CALL_UNAVAILABLE'].forEach(type => {
        wsClient.on(type, (data) => this.handleSignal(type, data));
      });
    },

    // ---------- 信令处理（App.vue/登录后由 registerCallHandlers 统一注册） ----------
    async handleSignal(type, data) {
      const d = data || {};
      switch (type) {
        case 'CALL_INVITE': {
          if (this.isActive) {
            // 占线：直接回 REJECT，让对方立即收到忙提示
            this._sendSignal('CALL_REJECT', { to: d.from, callId: d.callId });
            return;
          }
          this.$patch({
            status: 'incoming',
            media: d.media === 'audio' ? 'audio' : 'video',
            callId: d.callId,
            peerId: d.from,
            peerInfo: this._peerBrief(d.from)
          });
          // 通讯录尚未拉取时（刚登录直接来电）补拉一次，头像/昵称到位后 UI 自行刷新
          const cs = useContactsStore();
          if (!cs.friends.length) cs.fetchContacts();
          this._startRing('incoming');
          this._requestWakeLock();
          // 被叫 60s 无处理自动视为未接听，避免 UI 永久挂起
          clearTimeout(this._incomingTimer);
          this._incomingTimer = setTimeout(() => {
            if (this.status === 'incoming' && this.callId === d.callId) {
              this._sendSignal('CALL_REJECT', { to: d.from, callId: d.callId });
              this._cleanup();
            }
          }, 60000);
          break;
        }
        case 'CALL_ACCEPT': {
          // 应答方已就绪，发起方现在发出 offer
          if (this.status !== 'outgoing' || this.callId !== d.callId) return;
          clearTimeout(this._ringTimer);
          this._stopRing();
          const offer = await this._pc.createOffer();
          await this._pc.setLocalDescription(offer);
          this._sendSignal('CALL_SDP', { to: this.peerId, callId: this.callId, sdp: offer });
          break;
        }
        case 'CALL_REJECT': {
          if (this.callId !== d.callId) return;
          uni.showToast({ title: '对方已拒绝', icon: 'none' });
          this._cleanup();
          break;
        }
        case 'CALL_CANCEL': {
          if (this.callId !== d.callId) return;
          uni.showToast({ title: '对方已取消', icon: 'none' });
          this._cleanup();
          break;
        }
        case 'CALL_HANGUP': {
          if (this.callId !== d.callId) return;
          uni.showToast({ title: '通话已结束', icon: 'none' });
          this._cleanup();
          break;
        }
        case 'CALL_SDP': {
          if (this.callId !== d.callId || !this._pc) return;
          const desc = d.sdp;
          if (desc.type === 'offer') {
            await this._pc.setRemoteDescription(desc);
            this.status = 'connected';
            this.startedAt = Date.now();
            const answer = await this._pc.createAnswer();
            await this._pc.setLocalDescription(answer);
            this._sendSignal('CALL_SDP', { to: this.peerId, callId: this.callId, sdp: answer });
          } else if (desc.type === 'answer') {
            await this._pc.setRemoteDescription(desc);
            this.status = 'connected';
            this.startedAt = Date.now();
          }
          break;
        }
        case 'CALL_ICE': {
          if (this.callId !== d.callId || !this._pc) return;
          try {
            await this._pc.addIceCandidate(d.candidate);
          } catch (e) {
            // 候选者乱序/无效时静默忽略
          }
          break;
        }
        case 'CALL_UNAVAILABLE': {
          if (this.callId !== d.callId) return;
          uni.showToast({ title: '对方不在线', icon: 'none' });
          this._cleanup();
          break;
        }
      }
    },

    // ---------- 内部 ----------
    async _getLocalStream(media) {
      const wantVideo = media === 'video';
      try {
        const constraints = { audio: true, video: wantVideo ? { width: { ideal: 640 }, facingMode: 'user' } : false };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.localStream = stream;
        return stream;
      } catch (e) {
        // 摄像头缺失/拒绝时视频通话降级为语音
        if (wantVideo) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.localStream = stream;
            this.media = 'audio';
            uni.showToast({ title: '未检测到摄像头，已转为语音通话', icon: 'none' });
            return stream;
          } catch (e2) {
            uni.showToast({ title: '无法访问麦克风，请检查浏览器权限', icon: 'none' });
            return null;
          }
        }
        uni.showToast({ title: '无法访问麦克风，请检查浏览器权限', icon: 'none' });
        return null;
      }
    },

    _newPeer() {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this._sendSignal('CALL_ICE', { to: this.peerId, callId: this.callId, candidate: e.candidate.toJSON() });
        }
      };
      pc.ontrack = (e) => {
        this.remoteStream = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        this.connState = pc.connectionState;
        if (pc.connectionState === 'failed') {
          uni.showToast({ title: '连接失败，请检查网络', icon: 'none' });
          this.hangup();
        }
      };
      this._pc = pc;
    },

    // 来电时按用户 ID 取通讯录里的资料用于展示
    _peerBrief(userId) {
      const f = useContactsStore().friends.find(x => x._id === userId);
      if (f) return { nickname: f.remark || f.nickname || f.username, username: f.username, avatar: f.avatar };
      return { nickname: '', username: '', avatar: '' };
    },

    // ---------- 通话铃声（WebAudio 合成，无资源文件依赖） ----------
    // 来电双音"叮咚"每 2s、去电回铃长音每 3s；接通/结束时 _stopRing
    _startRing(kind) {
      this._stopRing();
      // #ifdef H5
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this._ringCtx = this._ringCtx || new Ctx();
        if (this._ringCtx.state === 'suspended') this._ringCtx.resume().catch(() => {});
        const ctx = this._ringCtx;
        const beep = (freq, dur, when, gainV = 0.08) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(gainV, when + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(when);
          osc.stop(when + dur + 0.05);
        };
        const loop = () => {
          const t = ctx.currentTime + 0.05;
          if (kind === 'incoming') {
            beep(880, 0.35, t);
            beep(660, 0.35, t + 0.45);
          } else {
            beep(440, 0.8, t, 0.05);
          }
        };
        loop();
        this._ringInterval = setInterval(loop, kind === 'incoming' ? 2000 : 3000);
      } catch (e) { /* 音频设备缺失时静默 */ }
      // #endif
    },

    _stopRing() {
      if (this._ringInterval) {
        clearInterval(this._ringInterval);
        this._ringInterval = null;
      }
    },

    // ---------- 屏幕常亮（H5 Wake Lock，不支持时静默） ----------
    async _requestWakeLock() {
      // #ifdef H5
      try {
        if (navigator.wakeLock) {
          this._wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (e) { /* 不支持或被拒绝不影响通话 */ }
      // #endif
    },

    _releaseWakeLock() {
      // #ifdef H5
      try {
        if (this._wakeLock) {
          this._wakeLock.release();
          this._wakeLock = null;
        }
      } catch (e) { /* ignore */ }
      // #endif
    },

    _cleanup() {
      clearTimeout(this._ringTimer);
      clearTimeout(this._incomingTimer);
      this._stopRing();
      this._releaseWakeLock();
      if (this._pc) {
        try { this._pc.close(); } catch (e) { /* ignore */ }
        this._pc = null;
      }
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
      }
      this.remoteStream = null;
      this.$patch({
        status: 'idle',
        callId: '',
        peerId: '',
        peerInfo: {},
        connState: '',
        muted: false,
        cameraOff: false,
        startedAt: 0
      });
    }
  }
});
