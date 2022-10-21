import { Config, Handlers, PingPongMap, Status } from '.';
import { aliCloseSocket, sleep } from './utils';

/** webSocket 处理函数:> 连接+断线重连+心跳检测 */
export class WebSocketCtrl {
  public config?: Config;
  public handlers = {} as Handlers;
  private socketTask: any;
  /** 重连最大次数 */
  private reconnect_max = 3;
  /** 心跳倒计时 - timeout  */
  private heartbeat_timeout: number;
  /** 心跳倒计时 - 运行时间 */
  private heartbeat_time = 5;
  /** ping pong 对应的字符 */
  private ping_pong_map?: PingPongMap;
  public status: Status;
  constructor(handlers: Handlers, ping_pong_map?: PingPongMap) {
    this.handlers = handlers;
    this.ping_pong_map = ping_pong_map;
    global.socket = this;
  }
  public setConfig(config: Config) {
    this.config = config;
  }
  private async innerConnect() {
    return new Promise<boolean>(async (resolve, _reject) => {
      if (!this.config) {
        return;
      }
      // console.warn(`WebSocket:>innerConnect`);
      const task: any = my.connectSocket({
        ...this.config,
        multiple: true,
        success: () => {
          let abort = false;
          // console.log(`WebSocket:>innerConnect:>success`);

          task.onError(async (e) => {
            console.log(`WebSocket:>innerConnect:>onError`);
            for (const key of Object.keys(e)) {
              console.log(`WebSocket:>innerConnect:>onError`, key, e[key]);
            }
            if (abort) {
              return;
            }
            await aliCloseSocket(task);
            abort = true;
            task.offError();
            task.offOpen();

            resolve(false);
          });

          task.onOpen(() => {
            console.log(`WebSocket:>innerConnect:>onOpen`);
            if (abort) {
              return;
            }
            abort = true;
            task.offError();
            task.offOpen();

            task.onMessage(this.onMessage);
            task.onClose(this.onClose);
            task.onError(this.onError);
            this.onOpen();
            this.socketTask = task;
            resolve(true);
          });
        },
        fail: (e) => {
          console.log(`WebSocket:>innerConnect:>fail`);
          for (const key of Object.keys(e)) {
            console.log(`WebSocket:>innerConnect:>onError`, key, e[key]);
          }
          resolve(false);
        },
      } as any);
    });
  }
  public async connect() {
    console.log(`WebSocket:>connect:>`);
    this.status = 'CONNECTING';
    for (let i = 0; i < this.reconnect_max; i++) {
      const connected = await this.innerConnect();
      if (connected) {
        return true;
      } else {
        await sleep(1);
      }
    }
    return false;
  }
  public send(data: string) {
    if (this.status !== 'OPEN' || !this.socketTask) {
      return console.error(`socket is no connected!`);
    }

    return new Promise((resolve) => {
      // console.log(`websocket:>send:>`, data);
      this.socketTask.send({
        data,
        success: () => {
          // console.log(`websocket:>send:>success`);
          resolve(true);
        },
        fail: () => {
          console.error(`websocket:>send:>fail`);
          resolve(false);
          this.reconnect();
        },
      });
    });
  }
  private onOpen = () => {
    console.log(`WebSocket:>onOpen`);

    this.status = 'OPEN';

    if (this.ping_pong_map) {
      this.startHeartBeat();
    }
  };
  private onMessage = (ev: any) => {
    const msg = ev.data.data as string;
    if (this.ping_pong_map) {
      const { ping, pong } = this.ping_pong_map;
      switch (msg) {
        case ping:
          this.send(pong);
          return;
        case pong:
          this.startHeartBeat();
          return;
      }
    }
    console.log(`websocket:>onMessage`, msg);
    this.handlers.onData?.(msg);
  };
  private onError = () => {
    // console.log(`WebSocket:>onError`);
    this.handlers.onError?.();
  };
  private onClose = () => {
    // console.log(`WebSocket:>onClose`);
    if (!this.socketTask) {
      return;
    }
    this.reconnect();
  };
  /**
   * 重连
   */
  public async reconnect() {
    console.warn(`WebSocket:>reconnect`);
    const { reconnect_max, handlers } = this;

    this.status = 'RECONNECTING';
    for (let i = 0; i < reconnect_max; i++) {
      handlers.onReconnect?.(i);
      await this.reset();
      const connected = await this.innerConnect();
      console.warn(`WebSocket:>reconnect:>time`, i, connected);
      if (connected) {
        this.handlers.onReconnected?.();
        return true;
      } else {
        await sleep(3);
      }
    }

    this.end();
    return false;
  }
  public startHeartBeat() {
    const { heartbeat_time } = this;

    console.log(`WebSocket:>startHeartBeat`);
    clearInterval(this.heartbeat_timeout);
    this.heartbeat_timeout = setTimeout(() => {
      // console.warn(`WebSocket:>startHeartBeat:>setTimeout`);
      this.reconnect();
    }, heartbeat_time * 1000) as unknown as number;
  }
  /**
   * 断开连接
   */
  public async disconnect() {
    if (this.status === 'CLOSED') {
      return;
    }
    return await this.end();
  }
  /** 真正的关闭 */
  private async end() {
    console.log(`WebSocket:>end`);
    await this.reset();
    this.config = undefined;
    this.status = 'CLOSED';
    this.handlers.onEnd?.();
    this.handlers = {};
  }
  /** 清理本地数据 */
  private reset() {
    return new Promise((resolve) => {
      if (!this.socketTask) {
        resolve(false);
        return;
      }

      this.socketTask.offClose();
      this.socketTask.offOpen();
      this.socketTask.offMessage();
      this.socketTask.offError();
      this.socketTask?.close({
        fail: () => {
          // console.log(`WebSocket:>reset:>fail`);
          resolve(false);
        },
        success: () => {
          // console.log(`WebSocket:>reset:>success`);
          resolve(true);
        },
      });
      // resolve(false);
    }).then((res) => {
      // console.log('WebSocket:>reset:>2');
      this.socketTask = undefined;
      clearTimeout(this.heartbeat_timeout);
      return res;
    });
  }
}
