import puppeteer from 'puppeteer';

export async function generateOffersScreenshot(offers: any[]): Promise<Buffer> {
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);

    let rowsHtml = '';
    for (const o of offers) {
        rowsHtml += `
        <tr>
            <td class="store-name">${o.storeName || '未知商户'}</td>
            <td>${o.product || o.productName || '未知产品'}</td>
            <td>巴西</td>
            <td>-3</td>
            <td><span class="tag-blue">3C-上架APP</span></td>
            <td class="text-center">淇林:OK<br/>${timeStr}<br/><div class="icon-circle">+</div></td>
            <td class="text-center"><div class="icon-circle">+</div></td>
            <td class="url-cell">
                <a href="#">${o.productUrl || o.url || 'https://play.google.com/store/apps/'}</a><br/>
                <span class="text-green">在线</span>
            </td>
            <td><div class="dropdown-orange">暂停 <span class="arrow">v</span></div></td>
            <td><div class="btn-blue">查看</div></td>
        </tr>
        `;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <style>
            body {
                margin: 0;
                padding: 20px;
                background: #f0f2f5;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            }
            .table-container {
                background: #fff;
                border: 1px solid #ebeef5;
                display: inline-block;
                min-width: 1200px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                text-align: center;
                font-size: 13px;
                color: #606266;
            }
            th {
                background: #fcfcfc;
                color: #909399;
                font-weight: bold;
                padding: 15px 10px;
                border-bottom: 1px solid #ebeef5;
                border-right: 1px solid #ebeef5;
            }
            td {
                padding: 15px 10px;
                border-bottom: 1px solid #ebeef5;
                border-right: 1px solid #ebeef5;
                vertical-align: middle;
            }
            .store-name {
                color: #606266;
                font-weight: 500;
            }
            .tag-blue {
                background: #8ab4f8;
                color: #fff;
                padding: 4px 8px;
                border-radius: 2px;
                font-size: 12px;
            }
            .text-center { text-align: center; }
            .icon-circle {
                display: inline-block;
                width: 20px;
                height: 20px;
                line-height: 18px;
                border-radius: 50%;
                background: #409eff;
                color: white;
                font-size: 16px;
                margin-top: 8px;
                cursor: pointer;
            }
            .url-cell {
                max-width: 220px;
                word-break: break-all;
                text-align: left;
                line-height: 1.5;
            }
            .url-cell a {
                color: #606266;
                text-decoration: none;
            }
            .text-green {
                color: #67c23a;
                font-weight: 500;
                display: block;
                text-align: center;
                margin-top: 8px;
            }
            .dropdown-orange {
                background: #e6a23c;
                color: white;
                padding: 6px 12px;
                border-radius: 3px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
                cursor: pointer;
                width: 60px;
            }
            .dropdown-orange .arrow {
                font-size: 10px;
                opacity: 0.8;
                transform: scaleY(0.8);
            }
            .btn-blue {
                background: #409eff;
                color: white;
                padding: 6px 16px;
                border-radius: 3px;
                display: inline-block;
                cursor: pointer;
            }
        </style>
    </head>
    <body>
        <div class="table-container" id="capture-area">
            <table>
                <thead>
                    <tr>
                        <th>商户名称 ↕</th>
                        <th>产品名称</th>
                        <th>投放国家</th>
                        <th>开户时区</th>
                        <th>产品类型</th>
                        <th>关联链接备注(优化填写)</th>
                        <th>大盘首存数</th>
                        <th>产品链接 ↕</th>
                        <th>投放状态</th>
                        <th>广告状态</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    </body>
    </html>
    `;

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-gpu'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1400, height: 800, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        // Wait for fonts to load
        await page.evaluate(() => document.fonts.ready);
        
        const element = await page.$('#capture-area');
        if (!element) throw new Error('Capture area not found');
        
        const buffer = await element.screenshot({ type: 'png' });
        return buffer as Buffer;
    } finally {
        await browser.close();
    }
}