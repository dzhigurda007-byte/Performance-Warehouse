# Performance Warehouse — онлайн-сервер склада (доступ из интернета только по приглашениям)
FROM node:22-alpine
WORKDIR /app
COPY app/ /app/
RUN addgroup -S pw && adduser -S pw -G pw && mkdir -p /data && chown -R pw:pw /data
USER pw
ENV PW_HOME=/app \
    PW_DATA=/data \
    PW_WEB=/app/web \
    PW_PORT=8080 \
    PW_ONLINE=1 \
    PW_TRUST_PROXY=1 \
    NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/ping >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "pw-server.cjs"]
