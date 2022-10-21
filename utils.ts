export function sleep(time: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, time * 1000);
  });
}

export function aliCloseSocket(task: any) {
  return new Promise((resolve) => {
    task.close({
      code: 1000,
      reason: 'socketTask1 正常关闭',
      fail: () => {
        console.log(`WebSocket:>aliCloseSocket:>fail`);
        resolve(false);
      },
      success: () => {
        console.log(`WebSocket:>aliCloseSocket:>success`);
        resolve(true);
      },
    });
  });
}
