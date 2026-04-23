declare module 'wechaty' {
  export interface WechatyOptions {
    name?: string;
    puppet?: string;
  }

  export class Contact {
    id: string;
    name(): string;
    say(text: string): Promise<void>;
  }

  export class Room {
    id: string;
    topic(): string;
    say(text: string): Promise<void>;
  }

  export class Message {
    id: string;
    text(): string;
    talker(): Contact;
    room(): Room | null;
    say(text: string): Promise<void>;
    mentionSelf(): boolean;
    mentionList(): Promise<Contact[]>;
  }

  export class Wechaty {
    constructor(options?: WechatyOptions);
    on(event: 'scan', handler: (qrcode: string, status: number) => void): this;
    on(event: 'login', handler: (user: Contact) => void): this;
    on(event: 'logout', handler: (user: Contact) => void): this;
    on(event: 'message', handler: (message: Message) => void): this;
    on(event: string, handler: (...args: unknown[]) => void): this;
    start(): Promise<void>;
    stop(): Promise<void>;
    logonoff(): boolean;
  }
}
