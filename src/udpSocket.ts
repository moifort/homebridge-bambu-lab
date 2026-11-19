import { createSocket, type Socket, type SocketType } from 'node:dgram';

export function closeSocket(socket: Socket): void {
  try {
    socket.close();
  } catch {
    // already closed
  }
}

/**
 * Binds a UDP socket on a random port. A bind failure rejects the promise; every error raised
 * once the socket is bound goes to `onLaterError` instead. So a failure is reported once, and the
 * socket always has an error listener (an `error` event without one would crash Homebridge).
 */
export function bindUdpSocket(
  type: SocketType,
  onLaterError: (error: Error) => void,
  address?: string,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(type);
    const onBindError = (error: Error) => {
      closeSocket(socket);
      reject(error);
    };
    socket.once('error', onBindError);
    socket.bind(0, address, () => {
      socket.off('error', onBindError);
      socket.on('error', onLaterError);
      resolve(socket);
    });
  });
}
