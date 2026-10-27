# The voice satellite (#223), for a Raspberry (arm64) or a PC: built from the repo's root, as it
# uses src/lib's wake word and VAD (see Dockerfile.dockerignore). Bun bundles it; Node runs it, as
# Bun's N-API still fails with onnxruntime-node.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json ./
COPY src/lib/vad.ts src/lib/wakeword.ts src/lib/wakeword-recorder.ts src/lib/voice.ts \
	src/lib/wake-words.ts src/lib/
COPY satellite/package.json satellite/bun.lock satellite/
RUN cd satellite && bun install --frozen-lockfile --production
COPY satellite/src satellite/src
RUN bun build satellite/src/main.ts --target=node --external onnxruntime-node --outfile satellite/dist/main.js

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends alsa-utils \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /satellite
# ONNX Runtime's usage reports, off: nothing leaves the satellite but the orders.
ENV ORT_DISABLE_TELEMETRY=1
COPY satellite/package.json ./
COPY --from=build /app/satellite/node_modules ./node_modules
COPY --from=build /app/satellite/dist/main.js ./
COPY static/wakeword/melspectrogram.onnx static/wakeword/embedding_model.onnx static/wakeword/hola_casita.onnx \
	static/wakeword/alexa.onnx static/wakeword/silero_vad.onnx ./models/
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "main.js"]
