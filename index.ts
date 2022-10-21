import Taro from '@tarojs/taro';

import { sleep } from './utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Config = { header: any; url: string };
export type PingPongMap = {
  ping: string;
  pong: string;
};

export type Handlers = {
  /** 接收数据 */
  onData?: (data: string) => void;
  /** 出现错误 */
  onError?: (error?: string) => void;
  /** 重连开始 */
  onReconnect?: (no: number) => void;
  /** 重连结束 */
  onReconnected?: () => void;
  /** 断开连接 */
  onEnd?: () => void;
};

export type Status = 'CONNECTING' | 'RECONNECTING' | 'OPEN' | 'CLOSED';

/** webSocket 处理函数:> 连接+断线重连+心跳检测 */
export class WebSocketCtrl {
  public config?: Config;
  public handlers = {} as Handlers;
  private socketTask?: Taro.SocketTask; // websocket实例

  /** 重连最大次数 */
  private reconnect_max = 5;
  /** 心跳倒计时 - timeout  */
  private heartbeat_interval: number;
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
      // console.log?.(`WebSocket:>innerConnect`);
      const options = {
        ...this.config,
        fail: () => {
          // console.log?.(`WebSocket:>innerConnect:>失败:>1`);
          resolve(false);
        },
      };
      const task = await Taro.connectSocket(options);
      // console.log?.(`WebSocket:>innerConnect:>2`);
      let abort = false;
      // const timeout = setTimeout(() => {
      //   abort = true;
      //   resolve(false);
      // }, 1000);

      task.onError(() => {
        // console.log(`WebSocket:>innerConnect:>onError`, err.errMsg);
        abort = true;
        resolve(false);
      });

      task.onOpen(() => {
        // clearTimeout(timeout);
        if (abort) {
          return;
        }
        // console.log?.(`WebSocket:>innerConnect:>success:>2`);
        this.socketTask = task;
        task.onMessage(this.onMessage);
        task.onClose(this.onClose);
        task.onError(this.onError);
        this.onOpen();
        resolve(true);
      });
    });
  }
  public async connect() {
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
      this.socketTask?.send({
        data,
        success: () => {
          // console.log(`websocket:>send:>success`);
          resolve(true);
        },
        fail: () => {
          // console.error(`websocket:>send:>fail`);
          resolve(false);
          this.reconnect();
        },
      });
    });
  }
  private onOpen = () => {
    // console.log?.(`WebSocket:>onOpen`);

    this.status = 'OPEN';

    if (this.ping_pong_map) {
      this.startHeartBeat();
    }
  };
  private onMessage = (ev: MessageEvent) => {
    const msg = ev.data;
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
    // console.log?.(`WebSocket:>onError`);
    this.handlers.onError?.();
  };
  private onClose = () => {
    // console.log?.(`WebSocket:>onClose`);
    if (!this.socketTask) {
      return;
    }
    this.reconnect();
  };
  /**
   * 重连
   */
  public async reconnect() {
    // console.warn(`WebSocket:>reconnect`);
    const { reconnect_max, handlers } = this;

    this.status = 'RECONNECTING';
    for (let i = 0; i < reconnect_max; i++) {
      handlers.onReconnect?.(i);
      await this.reset();
      const status = await this.innerConnect();
      console.warn(`WebSocket:>reconnect:>2`, i, status);
      if (status) {
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

    console.warn(`WebSocket:>startHeartBeat`);
    clearInterval(this.heartbeat_interval);

    this.heartbeat_interval = setInterval(() => {
      // console.warn(`WebSocket:>startHeartBeat:>setInterval`);
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
    // console.log(`WebSocket:>断开连接`);
    await this.reset();
    this.config = undefined;
    this.status = 'CLOSED';
    this.handlers.onEnd?.();
    this.handlers = {};
  }
  /** 清理本地数据 */
  private reset() {
    // console.log('WebSocket:>reset:>');
    return new Promise((resolve) => {
      if (!this.socketTask) {
        resolve(false);
        return;
      }

      this.socketTask?.close({
        code: 1000,
        reason: '关闭',
        success: () => {
          // console.log('WebSocket:> 主动关闭 success', this.socketTask?.close);
          resolve(true);
        },
        fail: (err) => {
          // console.log('WebSocket:> 主动关闭 WebSocket 失败！', err);
          resolve(false);
        },
      });
    }).then((res) => {
      // console.log('WebSocket:>reset:>2', this.socketTask);
      clearInterval(this.heartbeat_interval);
      this.socketTask = undefined;
      return res;
    });
  }
}
