# node:sqlite (the corpus store) requires Node >= 22.5 — Node 20 crashes on
# boot with ERR_UNKNOWN_BUILTIN_MODULE. Keep this pinned to the major we
# develop on.
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev
EXPOSE 3000
CMD ["node", "dist/index.js"]
