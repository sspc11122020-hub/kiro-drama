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

// ==================== إعدادات النظام ====================
const CONFIG = {
    homeItemsCount: 30,    // أحدث 30 فيديو للرئيسية
    videosPerFile: 35,     // 35 فيديو لكل ملف p
    requestDelay: 700,     // تأخير بسيط لتجنب الحظر
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const CHANNELS = [
    "Film.Arena",
    "Chnese-drama",
    "Drama-Portal",
    "Neon.History",
    "drama.box"
];

function generateRandomStats(originalValue) {
    return originalValue < 1000 ? Math.floor(Math.random() * 49000) + 1000 : originalValue;
}

// ==================== نظام طلبات Dailymotion API ====================
class DailymotionClient {
    constructor() {
        this.baseUrl = "https://api.dailymotion.com";
    }

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
        // جلب 100 فيديو من كل قناة (يمكنك زيادة الليميت إذا أردت المزيد)
        const url = `${this.baseUrl}/user/${username}/videos?fields=id,title,thumbnail_url,duration,created_time,views_total&limit=100&sort=recent`;
        const response = await fetch(url, { headers: { 'User-Agent': CONFIG.userAgent } });
        return await response.json();
    }
}

// ==================== المعالج الرئيسي ====================
class ChronologicalScraper {
    constructor() {
        this.client = new DailymotionClient();
        this.masterList = []; // القائمة الكبيرة لكل القنوات
        this.arabicRegex = /[\u0600-\u06FF]/;
    }

    async run() {
        console.log("🚀 جاري جمع الفيديوهات العربية من كافة القنوات...");

        for (const channel of CHANNELS) {
            const data = await this.client.getUserVideos(channel);
            if (!data.list) continue;

            for (const video of data.list) {
                if (this.arabicRegex.test(video.title)) {
                    this.masterList.push(video);
                }
            }
        }

        // --- الخطوة السحرية: الترتيب الزمني من الأحدث للأقدم ---
        console.log("⚖️ جاري ترتيب الفيديوهات حسب تاريخ النشر...");
        this.masterList.sort((a, b) => b.created_time - a.created_time);

        console.log(`✅ إجمالي الفيديوهات المكتشفة: ${this.masterList.length}. جاري استخراج روابط m3u8...`);

        const finalizedVideos = [];
        // سنبدأ الآن باستخراج الروابط بالترتيب الجديد
        for (const video of this.masterList) {
            console.log(`🔗 معالجة: ${video.title.substring(0, 40)}...`);
            const m3u8Link = await this.client.getM3U8Url(video.id);

            finalizedVideos.push({
                id: video.id,
                title: video.title,
                thumbnail: video.thumbnail_url,
                m3u8Url: m3u8Link,
                embedUrl: `https://www.dailymotion.com/embed/video/${video.id}`,
                duration: video.duration,
                views: generateRandomStats(video.views_total),
                uploadedAt: new Date(video.created_time * 1000).toISOString(),
                timestamp: video.created_time // للتحقق فقط
            });

            await new Promise(r => setTimeout(r, CONFIG.requestDelay));
        }

        await this.distributeFiles(finalizedVideos);
    }

    async distributeFiles(videos) {
        // 1. ملف Home.json (أحدث 30)
        const homeChunk = videos.slice(0, CONFIG.homeItemsCount);
        await fs.promises.writeFile(path.join(VIDEOS_DIR, "Home.json"), JSON.stringify(homeChunk, null, 2));
        console.log(`🏠 تم إنشاء Home.json بأحدث 30 فيديو.`);

        // 2. ملفات p1, p2... (البقية مقسمة كل 35)
        const remaining = videos.slice(CONFIG.homeItemsCount);
        for (let i = 0; i < remaining.length; i += CONFIG.videosPerFile) {
            const chunk = remaining.slice(i, i + CONFIG.videosPerFile);
            const fileNumber = Math.floor(i / CONFIG.videosPerFile) + 1;
            const fileName = `p${fileNumber}.json`;
            
            await fs.promises.writeFile(path.join(VIDEOS_DIR, fileName), JSON.stringify(chunk, null, 2));
            console.log(`📄 تم إنشاء ${fileName} بـ ${chunk.length} فيديو (ترتيب أقدم).`);
        }

        console.log("\n✨ تمت المهمة بنجاح وفيديوهاتك الآن مرتبة زمنياً!");
    }
}

const scraper = new ChronologicalScraper();
scraper.run();
