FROM node:18-alpine

WORKDIR /app

# Copy package.json from root (build context is project root)
COPY package*.json ./

RUN npm install --production

# Copy only the mock receiver file
COPY mock-receiver/server.js ./server.js

EXPOSE 4000

CMD ["node", "server.js"]