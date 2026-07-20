FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY widget/package.json widget/
COPY shared/package.json shared/
RUN npm ci --workspaces --include-workspace-root --engine-strict=false

COPY tsconfig.base.json ./
COPY shared ./shared
COPY widget ./widget

RUN npm --workspace @livechat/widget run build

FROM nginx:1.27-alpine AS runtime
COPY widget/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/widget/dist /usr/share/nginx/html
COPY widget/index.html /usr/share/nginx/html/index.html
EXPOSE 80
