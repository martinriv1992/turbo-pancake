# Runs the web app and the job worker in one container.
# Needs: DATABASE_URL, SESSION_SECRET (and optionally ANTHROPIC_API_KEY, STORAGE_* / SUPABASE_* variables).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Applies any new migrations, then starts the server (which also starts the worker).
CMD ["sh", "-c", "npm run db:migrate && npx next start -p ${PORT}"]
