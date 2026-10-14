/**
 * WebRTC ICE servers configuration (STUN / TURN)
 */
function getIceServers() {
  const iceServers = [
    { urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  if (process.env.TURN_URL) {
    const turnServer = { urls: process.env.TURN_URL };
    if (process.env.TURN_USERNAME) turnServer.username = process.env.TURN_USERNAME;
    if (process.env.TURN_CREDENTIAL) turnServer.credential = process.env.TURN_CREDENTIAL;
    iceServers.push(turnServer);
  }

  return iceServers;
}

module.exports = { getIceServers };
