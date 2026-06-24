import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== إعدادات المسارات ====================
const DAILYMOTION_DIR = path.join(__dirname, "Dailymotion");
const VIDEOS_DIR = path.join(DAILYMOTION_DIR, "Videos");

const createDirectories = async () => {
    if (!fs.existsSync(VIDEOS_DIR)) await fs.promises.mkdir(VIDEOS_DIR, { recursive: true });
};
await createDirectories();

// ==================== إعدادات النظام المحدثة ====================
const CONFIG = {
    videosPerFile: 100,      // 100 فيديو لكل ملف
    requestDelay: 500,       // تأخير أقل لزيادة السرعة
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const CHANNELS = ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"];

class DailymotionClient {
    async getM3U8Url(videoId) {
        try {
            const response = await fetch(`https://www.dailymotion.com/player/metadata/video/${videoId}`, {
                headers: { 'User-Agent': CONFIG.userAgent }
            });
            const data = await response.json();
            return data.qualities?.auto?.[0]?.url || "";
        } catch { return ""; }
    }

    async getUserVideos(username) {
        console.log(`📡 جلب بيانات القناة: ${username}...`);
        // زيادة الليميت إلى 200 لجلب أكبر قدر ممكن من كل قناة
        const url = `https://api.dailymotion.com/user/${username}/videos?fields=id,title,thumbnail_url,duration,created_time,views_total&limit=200&sort=recent`;
        const response = await fetch(url, { headers: { 'User-Agent': CONFIG.userAgent } });
        return await response.json();
    }
}

class ChronologicalScraper {
    constructor() {
        this.client = new DailymotionClient();
        this.masterList = [];
    }

    async run() {
        for (const channel of CHANNELS) {
            const data = await this.client.getUserVideos(channel);
            if (data.list) this.masterList.push(...data.list);
        }

        // ترتيب الأحدث أولاً
        this.masterList.sort((a, b) => b.created_time - a.created_time);

        const finalizedVideos = [];
        for (const video of this.masterList) {
            const m3u8Link = await this.client.getM3U8Url(video.id);
            finalizedVideos.push({
                id: video.id,
                title: video.title,
                thumbnail: video.thumbnail_url,
                m3u8Url: m3u8Link,
                uploadedAt: new Date(video.created_time * 1000).toISOString()
            });
            await new Promise(r => setTimeout(r, CONFIG.requestDelay));
        }

        // توزيع الملفات
        for (let i = 0; i < finalizedVideos.length; i += CONFIG.videosPerFile) {
            const chunk = finalizedVideos.slice(i, i + CONFIG.videosPerFile);
            const fileNumber = (i / CONFIG.videosPerFile) + 1;
            await fs.promises.writeFile(path.join(VIDEOS_DIR, `p${fileNumber}.json`), JSON.stringify(chunk, null, 2));
        }
        console.log(`✨ تم الحفظ بنجاح!`);
    }
}

new ChronologicalScraper().run();
