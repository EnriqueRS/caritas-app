FROM node:22-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server server
COPY web web
ENV NODE_ENV=production TZ=Europe/Madrid
EXPOSE 3010
CMD ["node", "server/index.js"]
