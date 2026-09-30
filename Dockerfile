FROM oven/bun:1.4-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --production --frozen-lockfile || bun install --production
COPY . .
ENV PORT=8787
ENV DATA_DIR=/data
ENV DATABASE_PATH=/data/todo.db
EXPOSE 8787
VOLUME ["/data"]
CMD ["bun", "run", "src/index.ts"]
