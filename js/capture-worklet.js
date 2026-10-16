// Récupère les échantillons du micro par blocs de 1024 avec leur position exacte dans le temps audio.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
    this.start = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.n === 0) this.start = currentFrame;
      this.buf.set(ch, this.n);
      this.n += ch.length;
      if (this.n >= 1024) {
        this.port.postMessage({ frame: this.start, data: this.buf.slice(0, this.n) });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
