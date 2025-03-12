FROM node:23-alpine AS base
WORKDIR /usr/local/app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /usr/local/app
USER appuser
COPY --chown=appuser:appgroup package.json package-lock.json ./

FROM base AS dev
ENV NODE_ENV=development
RUN --mount=type=cache,target=/root/.npm npm install
CMD ["npm", "run", "dev-container"]

FROM base AS final
ENV NODE_ENV=production
RUN --mount=type=cache,target=/root/.npm npm ci --production --ignore-scripts && npm cache clean --force
COPY --chown=appuser:appgroup ./src ./src
EXPOSE 3000
CMD ["node", "src/index.js"]