export class QLApi {
    private currentToken: string | null = null;
    private tokenExpireTime: number = 0;
    private baseUrl = 'https://www.ql-agency.com';

    async login(): Promise<string> {
        const payload = {
            phone: process.env.QL_USERNAME || '',
            password: process.env.QL_PASSWORD || '',
            id: "",
            code: ""
        };
        
        console.log(`[QL API] Logging in with user: ${payload.phone}`);

        const response = await fetch(`${this.baseUrl}/api/user/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.code === 100 && data.info?.data?.token) {
            this.currentToken = data.info.data.token;
            // Token usually expires in 5 days, set refresh threshold to 4 days
            this.tokenExpireTime = Date.now() + (4 * 24 * 60 * 60 * 1000);
            console.log('[QL API] Login successful, token acquired.');
            return this.currentToken!;
        }
        
        throw new Error("QL API 登录失败: " + JSON.stringify(data));
    }

    async qlFetch(path: string, options: any = {}) {
        if (!this.currentToken || Date.now() > this.tokenExpireTime) {
            await this.login();
        }

        const headers = {
            'Content-Type': 'application/json',
            'token': this.currentToken,
            ...(options.headers || {})
        };

        const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
        const data = await res.json();

        // Fallback for unexpected token expiration
        if (data.code === 401 || (data.msg && data.msg.toLowerCase().includes("token"))) {
            console.log("[QL API] Token 失效或被踢，触发强制重新登录...");
            await this.login();
            headers.token = this.currentToken;
            const retryRes = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
            return await retryRes.json();
        }

        return data;
    }

    async listStoreToSelect(): Promise<any[]> {
        // pageRow=1000 to get all possible stores
        const data = await this.qlFetch('/api/store/listStoreToSelect?pageNum=1&pageRow=1000&storeType=1', { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error("获取商户列表失败: " + JSON.stringify(data));
    }

    async listOffer(storeId: number): Promise<any[]> {
        // productType=1 may vary, we might need to adjust or remove it if not strictly required
        const data = await this.qlFetch(`/api/offer/listOffer?pageNum=1&pageRow=10&storeId=${storeId}&productType=1`, { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error(`获取 Offer 列表失败 (storeId: ${storeId}): ` + JSON.stringify(data));
    }

    async addOffer(offerObj: any): Promise<any> {
        const payload = {
            jsonStr: JSON.stringify(offerObj)
        };

        const data = await this.qlFetch('/api/offer/addOffer', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (data.code === 100) {
            return data;
        }
        throw new Error("添加 Offer 失败: " + JSON.stringify(data));
    }
}

export const qlApi = new QLApi();
