const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/happychat')
  .then(() => { console.log('MongoDB OK'); process.exit(0); })
  .catch(e => { console.error('MongoDB Error:', e.message); process.exit(1); });
