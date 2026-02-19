# mock-receiver/Dockerfile

FROM node:18-alpine

WORKDIR /app

# Copy package files from the root (mock-receiver shares the same package.json)
COPY package*.json ./

RUN npm install --production

# Only copy what the mock receiver needs
COPY mock-receiver/ ./mock-receiver/

# The .env is handled via docker-compose environment variables,
# but we load dotenv as a fallback
COPY .env.example .env

CMD ["node", "mock-receiver/server.js"]
