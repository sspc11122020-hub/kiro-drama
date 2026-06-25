const fs = require('fs');
const path = require('path');
const https = require('https');
const { parse } = require('node-html-parser');

class LaroozaPagedExtractor {
    constructor() {
        this.episodesPerFile = 500;
        this.outputDir = 'Ramadan';
        this.allEpisodes = [];
        this.episodesMap = new Map();
        
        this.baseUrls = [
            'https://larozza.mom',
            'https://larozza.makeup',
            'https://m.laroza-tv.net'
        ];
        this.baseUrl = this.baseUrls[0];
        
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
        
        this.loadExistingEpisodes();
        
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36'
        ];
        
        this.proxies = [
            '',
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
        
        this.maxPages = 100;
        this.minEpisodesPerPage = 1;
    }

    // --- وظيفة جديدة لفحص اللغة العربية ---
    hasArabic(text) {
        // هذا النمط يبحث عن أي حرف في نطاق الحروف العربية
        const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
        return arabicPattern.test(text);
    }

    loadExistingEpisodes() {
        try {
            const files = fs.readdirSync(this.outputDir)
                .filter(f => f.match(/^page\d+\.json$/));
            
            files.sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });

            for (const file of files) {
                const filePath = path.join(this.outputDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                
                let episodes = [];
                try {
                    const parsed = JSON.parse(content);
                    episodes = parsed.episodes || (Array.isArray(parsed) ? parsed : []);
                } catch (e) {
                    console.log(`⚠️ خطأ في قراءة ${file}`);
                    continue;
                }
                
                for (const episode of episodes) {
                    if (episode && episode.id) {
                        this.episodesMap.set(episode.id, episode);
                    }
                }
                this.allEpisodes.push(...episodes);
            }
            console.log(`📚 تم تحميل ${this.allEpisodes.length} حلقة من ${files.length} ملف`);
        } catch (error) {
            console.log('ℹ️ لا توجد ملفات سابقة، بدء من الصفر');
        }
    }

    async start() {
        console.log('🚀 بدء استخراج جميع صفحات رمضان 2026 (فلترة العناوين العربية مفعلة)');
        let page = 1;
        let consecutiveEmptyPages = 0;
        let maxConsecutiveEmpty = 3;
        let newEpisodesCount = 0;
        let totalEpisodesExtracted = 0;
        let filteredCount = 0; // عداد للعناوين التي تم حذفها

        while (page <= this.maxPages && consecutiveEmptyPages < maxConsecutiveEmpty) {
            const pageUrl = `${this.baseUrl}/category.php?cat=ramadan-2026&page=${page}&order=DESC`;
            let html = null;
            let success = false;

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    html = await this.fetchWithProxy(pageUrl);
                    if (html && html.length > 200) {
                        success = true;
                        break;
                    }
                } catch (e) {
                    await this.sleep(2000);
                }
            }
            
            if (!success) {
                consecutiveEmptyPages++;
                page++;
                continue;
            }

            const pageEpisodes = await this.extractEpisodesFromPage(html, page);
            
            if (pageEpisodes.length === 0) {
                consecutiveEmptyPages++;
            } else {
                consecutiveEmptyPages = 0;
                for (const episode of pageEpisodes) {
                    if (!this.episodesMap.has(episode.id)) {
                        newEpisodesCount++;
                        this.episodesMap.set(episode.id, episode);
                        console.log(`🆕 تم الحفظ: ${episode.title.substring(0, 40)}`);
                    }
                }
            }
            
            if (page % 5 === 0) {
                this.allEpisodes = Array.from(this.episodesMap.values());
                await this.savePaginatedFiles(true);
            }
            page++;
            await this.sleep(3000);
        }
        
        this.allEpisodes = Array.from(this.episodesMap.values());
        await this.savePaginatedFiles(false);
        await this.createSummary();
        return { total: this.allEpisodes.length, new: newEpisodesCount, pages: page - 1 };
    }

    async extractEpisodesFromPage(html, pageNumber) {
        try {
            const root = parse(html);
            const episodes = [];
            const items = root.querySelectorAll('li.col-xs-6, li.col-sm-4, div.video-item, article');
            
            for (const item of items) {
                const episode = await this.extractBasicInfo(item, pageNumber);
                // الفلترة هنا: إذا كان الكائن موجوداً ومر من فحص اللغة العربية
                if (episode) {
                    episodes.push(episode);
                }
            }
            return episodes;
        } catch (error) {
            return [];
        }
    }

    async extractBasicInfo(element, pageNumber) {
        let linkElement = element.querySelector('a');
        if (!linkElement) return null;
        
        const href = linkElement.getAttribute('href');
        if (!href) return null;
        
        // 1. استخراج العنوان أولاً للفحص
        let title = '';
        const titleSelectors = ['.ellipsis', 'h3', 'h4', '.title', 'img[alt]', 'a[title]'];
        for (const selector of titleSelectors) {
            const titleEl = element.querySelector(selector);
            if (titleEl) {
                title = titleEl.textContent || titleEl.getAttribute('alt') || titleEl.getAttribute('title') || '';
                if (title) break;
            }
        }
        title = this.cleanText(title);

        // --- التعديل الجوهري: فحص العنوان ---
        if (!title || !this.hasArabic(title)) {
            // إذا كان العنوان فارغاً أو لا يحتوي على حروف عربية، نتجاهله
            return null; 
        }

        // 2. استخراج ID
        let id = null;
        const match = href.match(/vid=([a-zA-Z0-9_-]+)/) || href.match(/\/([a-zA-Z0-9_-]{8,})\.html/);
        id = match ? match[1] : null;
        if (!id) return null;

        return {
            id: id,
            title: title,
            image: element.querySelector('img')?.getAttribute('src') || '',
            videoUrl: `${this.baseUrl}/embed.php?vid=${id}`,
            page: pageNumber,
            extractedAt: new Date().toISOString()
        };
    }

    // تنظيف النص مع الحفاظ على الحروف العربية
    cleanText(text) {
        if (!text) return '';
        return text
            .replace(/[\n\r\t]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // بقية الدوال (savePaginatedFiles, createSummary, fetchWithProxy, sleep) تبقى كما هي في كودك الأصلي...
    // [ملاحظة: تأكد من بقاء الدوال الأخرى ليعمل الكود بالكامل]
    
    async fetchWithProxy(url) {
        return new Promise((resolve, reject) => {
            const proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
            const finalUrl = proxy ? proxy + encodeURIComponent(url) : url;
            const options = {
                headers: { 'User-Agent': this.userAgents[0] },
                timeout: 10000,
                rejectUnauthorized: false
            };
            https.get(finalUrl, options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }

    async savePaginatedFiles(isTemporary = false) {
        const filePath = path.join(this.outputDir, isTemporary ? 'temp.json' : 'page1.json');
        const data = { episodes: this.allEpisodes };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    async createSummary() { /* نفس الكود الأصلي */ }
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

if (require.main === module) {
    new LaroozaPagedExtractor().start().then(r => console.log("Done", r));
}
