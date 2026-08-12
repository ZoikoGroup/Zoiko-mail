FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# Supply a dummy DATABASE_URL so prisma generate succeeds during image build
RUN DATABASE_URL="postgresql://zoiko:zoiko@localhost:5432/zoiko_mail" npm run db:generate && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# The runtime `npm ci` above installs a fresh node_modules without the generated
# Prisma client, so carry over the client produced by the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
RUN mkdir -p /app/storage/attachments /app/storage/exports && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["sh", "-c", "npm run db:migrate:deploy && npm start"]
