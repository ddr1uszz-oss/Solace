// Seeded RNG whose state lives inside the (serializable) game state object,
// so a game can be saved, restored, or replayed on a server.
export class Rng {
  constructor(box) { this.box = box; }            // box = { s: <uint32> }
  next() {
    const b = this.box;
    b.s = (b.s + 0x6d2b79f5) >>> 0;
    let t = b.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
  pick(arr) { return arr[this.int(arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
