import net from 'node:net';
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  if (args[0] === 3001) args[0] = 3003;
  return listen.apply(this, args);
};
