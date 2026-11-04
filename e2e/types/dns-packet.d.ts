// dns-packet（型定義を同梱しないため、使う範囲だけを宣言する）。
declare module "dns-packet" {
  export interface Question {
    type: string;
    name: string;
    class?: string;
  }
  export interface Answer {
    type: string;
    name: string;
    ttl?: number;
    data: string;
  }
  export interface Packet {
    id?: number;
    type?: "query" | "response";
    flags?: number;
    questions?: Question[];
    answers?: Answer[];
  }
  export function encode(packet: Packet): Buffer;
  export function decode(buf: Buffer): Packet;
}
