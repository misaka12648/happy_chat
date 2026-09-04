import { createPinia } from 'pinia';

const pinia = createPinia();

export default pinia;

export { useUserStore } from '@/store/user';
export { useChatStore } from '@/store/chat';
export { useContactsStore } from '@/store/contacts';
