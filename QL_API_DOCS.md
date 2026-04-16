# QL 自动录入机器人 - 核心逻辑与接口文档

## 一、 核心业务流水线 (Pipeline Logic)

整个机器人的核心录入引擎位于 `src/bot/ql-writer.ts`，其完整的数据流转逻辑如下：

1. **消息拦截与清洗 (Rule Engine)**
   - 监听 Telegram 群聊消息，触发预设关键词（如“神包上线”或包含链接）。
   - 通过 `routes.json` 中的正则或关键词提取规则，将文本转化为结构化数据：`客户` (对应 customerName)、`编号` (提取末尾数字)、`APP链接/链接` (覆盖目标 URL)。

2. **随机延迟风控 (Anti-ban Delay)**
   - 当批量录入多条数据时，从第二条开始，系统会在配置的 `DELAY_MIN_SECONDS` 和 `DELAY_MAX_SECONDS`（默认 6-12 秒）之间随机暂停。
   - 目的：模拟真人操作频率，防止被 QL 系统接口封控或限流。

3. **商户匹配 (Store Matching)**
   - 调用 `listStoreToSelect` 接口拉取当前系统内的所有商户列表。
   - 根据清洗出的 `客户` 名称（如 `866VIP-1320-XX`），在商户列表中进行模糊匹配（`storeName.includes(customerName)`），从而获取该商户在 QL 系统中的唯一 `storeId`。

4. **母本获取与克隆 (Template Cloning & Modification)**
   - 根据上一步拿到的 `storeId`，调用 `listOffer` 接口获取该商户下最新的历史录入记录。
   - 取返回列表的第一条（最新一条）作为**母本 (Base Offer)**。
   - **深拷贝母本**，并剔除掉不能重复的系统字段：`id`、`createdAt`、`updatedAt`。
   - **正则替换后缀**：从清洗出的 `编号` 中提取末尾的连续数字（如从 `APK60` 中提取 `60`），然后将母本中以下字段末尾的数字替换为新数字：
     - `product` (产品名称)
     - `bianHao` (编号)
     - `thirdName` (第三方名称)
     - `adName` (广告名称)
   - **替换链接**：将清洗出的 `APP链接` / `链接` 覆盖母本的 `productUrl` 字段。

5. **提交录入 (Submit Offer)**
   - 将组装好的新 Offer 对象序列化为 JSON 字符串，通过 `addOffer` 接口提交到 QL 系统。

6. **成功与失败闭环 (Logging & Queue)**
   - **成功**：记录耗时和内容，写入 `data/record-log.jsonl`，在 WebApp 的“日志”页面展示。
   - **失败**：如果中间任何一步（如 Token 失效、找不到商户、找不到母本、网络超时）抛出异常，将当前数据和错误信息存入 `data/queue-log.jsonl`，在 WebApp 的“队列”页面展示，供管理员后续“一键重试”。

---

## 二、 接口交互规范 (API Specifications)

接口封装层位于 `src/bot/ql-api.ts`。所有接口基于统一的基础配置：
- **Base URL**: `https://www.ql-agency.com`
- **公共请求头 (Headers)**:
  - `Content-Type: application/json`
  - `token: <JWT_TOKEN>` (登录接口外，所有接口必带)
- **Token 保活机制**: 自动解析 Token，默认有效期 5 天，系统设定 4 天刷新阈值；若接口返回 `401` 或包含 `token` 字样的错误信息，自动触发强制重新登录并重试失败的请求。

### 1. 登录并获取 Token
- **接口路径**: `POST /api/user/login`
- **请求体 (JSON)**:
  ```json
  {
      "phone": "648564045@qq.com",
      "password": "YOUR_PASSWORD",
      "id": "",
      "code": ""
  }
  ```
- **响应示例**:
  ```json
  {
      "code": 100,
      "info": {
          "data": {
              "token": "eyJhbGciOiJIUzI1NiIsInR5..."
          }
      }
  }
  ```

### 2. 获取商户列表 (用于获取 StoreId)
- **接口路径**: `GET /api/store/listStoreToSelect?pageNum=1&pageRow=1000&storeType=1`
- **说明**: `pageRow=1000` 用于一次性拉取所有商户，避免分页查询导致漏匹配。
- **响应示例**:
  ```json
  {
      "code": 100,
      "info": {
          "data": [
              {
                  "storeId": 1320,
                  "storeName": "866VIP-1320-XX"
              }
          ]
      }
  }
  ```

### 3. 获取历史 Offer 列表 (用于获取母本)
- **接口路径**: `GET /api/offer/listOffer?pageNum=1&pageRow=10&storeId={storeId}&productType=1`
- **说明**: 传入指定的 `storeId`，获取最近的 10 条 Offer 记录。取 `data[0]` 作为克隆模板。
- **响应示例**:
  ```json
  {
      "code": 100,
      "info": {
          "data": [
              {
                  "id": 9999,
                  "storeId": 1320,
                  "product": "866vip-1201-GG-APK59",
                  "bianHao": "APK59",
                  "productUrl": "https://play.google.com/...",
                  "createdAt": "2026-04-15T10:00:00Z"
                  // ... 其他几十个字段
              }
          ]
      }
  }
  ```

### 4. 提交新增 Offer
- **接口路径**: `POST /api/offer/addOffer`
- **请求体 (JSON)**:
  - 注意：这里 QL 系统的要求是将整个新 Offer 对象序列化后，作为 `jsonStr` 字段的值传入。
  ```json
  {
      "jsonStr": "{\"storeId\":1320,\"product\":\"866vip-1201-GG-APK60\",\"bianHao\":\"APK60\",\"productUrl\":\"https://play.google.com/...\"}"
  }
  ```
- **响应示例**:
  ```json
  {
      "code": 100,
      "msg": "操作成功"
  }
  ```