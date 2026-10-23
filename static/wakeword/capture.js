// The microphone, as the wake word detector wants it (#144): an AudioWorklet in an AudioContext at
// 16 kHz (the browser resamples), sending each 80 ms (1280 samples) as int16 values in floats.
class Capture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buffer = new Float32Array(1280);
		this.filled = 0;
	}
	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true;
		for (let i = 0; i < channel.length; i++) {
			const s = Math.max(-1, Math.min(1, channel[i]));
			this.buffer[this.filled++] = Math.round(s < 0 ? s * 32768 : s * 32767);
			if (this.filled === this.buffer.length) {
				this.port.postMessage(this.buffer);
				this.buffer = new Float32Array(1280);
				this.filled = 0;
			}
		}
		return true;
	}
}
registerProcessor('wakeword-capture', Capture);
