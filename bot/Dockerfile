# 把 stockie 打包成「容器」，Cloud Run 會用這個來執行
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY site ./site
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
