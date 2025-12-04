import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from "firebase/app";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    collection,
    query,
    where,
    getDocs, 
    serverTimestamp
} from "firebase/firestore";

// ==============================
// ⚙️ CONFIGURATION
// ==============================
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const PORT = process.env.PORT || 3000;

const REWARD_AMOUNT = 500;
const WEB_APP_URL = "https://khanbhai009-cloud.github.io/Tg-bot";
const WELCOME_IMAGE_URL = "https://i.ibb.co/932298pT/file-32.jpg";

const firebaseConfig = {
    apiKey: "AIzaSyCY64NxvGWFC_SZxcAFX3ImNQwY3H-yclw",
    authDomain: "tg-web-bot.firebaseapp.com",
    projectId: "tg-web-bot",
    storageBucket: "tg-web-bot.firebasestorage.app",
    messagingSenderId: "69446541874",
    appId: "1:69446541874:web:1ad058194db70530ff922b"
};

// ==============================
// 🔗 FIREBASE & TELEGRAM INIT
// ==============================
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const app = express();
app.use(express.json());

// ==============================
// 🛠️ HELPERS
// ==============================

/**
 * /start deep link se referral ID nikalta hai.
 * Now robust: supports "ref123", "?ref=123", plain "123", etc.
 */
function extractReferralId(raw) {
    if (!raw) return null;
    // remove spaces, ?, = characters
    let clean = raw.replace(/[\s?=]+/g, "");
    // if it starts with "ref", strip that prefix
    if (clean.toLowerCase().startsWith("ref")) {
        clean = clean.substring(3);
    }
    return clean || null;
}

/**
 * Naya user banata hai ya maujooda user ka refferBy field update karta hai (agar null ho).
 */
async function createOrUpdateUser(userId, name, referralId = null) {
    const refUser = doc(db, "users", String(userId));
    const snap = await getDoc(refUser);

    if (!snap.exists()) {
        const data = {
            id: String(userId),
            name,
            photoURL: "", 
            coins: 0,
            reffer: 0,
            refferBy: referralId || null, 
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false, 
            rewardgiven: false, // 🛑 Nayi FIELD shamil ki gayi
        };
        await setDoc(refUser, data);
        console.log(`🔥 New user created: ${userId}`);
        return data;
    } else {
        let existing = snap.data();
        let updateData = {};

        // Agar refferBy set nahi hai toh update karein
        if (!existing.refferBy && referralId) {
            updateData.refferBy = referralId;
        }

        // Ensure rewardgiven exists if it's an old doc
        if (existing.rewardgiven === undefined) {
            updateData.rewardgiven = false;
        }

        if (Object.keys(updateData).length > 0) {
            await updateDoc(refUser, updateData);
            return { ...existing, ...updateData };
        }

        return existing;
    }
}

/**
 * Referral reward deta hai aur rewardgiven flag ko TRUE set karta hai.
 * NOTE: Is function ko call karne se pehle eligibility check ho chuki hai.
 */
async function grantRewardAndMarkComplete(userId, referrerId) {
    // 1. Khud ka referral protection 
    if (String(userId) === String(referrerId)) {
        await updateDoc(doc(db, "users", String(userId)), { frontendOpened: false, rewardgiven: true }); // Khud ko bhi mark karein
        console.warn(`🛑 Self referral attempt blocked for ${userId}`);
        return;
    }

    // 2. Referrer (User A) ko update karein: coins +500, reffer +1
    const refRef = doc(db, "users", String(referrerId));
    await updateDoc(refRef, {
        coins: increment(REWARD_AMOUNT),
        reffer: increment(1)
    });

    // 3. User B ke fields ko update karein:
    //    a) rewardgiven: TRUE (Reward mil chuka hai)
    //    b) frontendOpened: FALSE (Worker queue se hatane ke liye)
    const userRef = doc(db, "users", String(userId));
    await updateDoc(userRef, {
        frontendOpened: false, 
        rewardgiven: true,
    });

    // 4. Ledger Entry (Record rakhne ke liye)
    await setDoc(doc(db, "ref_rewards", String(userId)), {
        userId: String(userId),
        referrerId: String(referrerId),
        reward: REWARD_AMOUNT,
        createdAt: serverTimestamp()
    });

    // 5. Referrer ko soochit karein
    try {
        await bot.sendMessage(
            referrerId,
            `🎉 *Referral Bonus!* Aapne *${REWARD_AMOUNT} coins* kamaaye kyunki aapke referral ne app khola!`, 
            { parse_mode: "Markdown" }
        );
    } catch (e) {
         console.log(`Referrer ko soochit nahi kar saka ${referrerId}`);
    }

    console.log(`✅ Reward granted: ${referrerId} <- ${userId}`);
}

// ==============================
// 🤖 TELEGRAM HANDLER: /start
// ==============================
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || "User";

    const raw = match[1]?.trim();
    const referralId = extractReferralId(raw);

    // 1. Upyogakarta ko banayein/update karein
    await createOrUpdateUser(chatId, name, referralId);

    // 2. Welcome message (referral link MESSAGE REMOVED per request)
    const welcomeCaption = `
👋 Namaste! Swagat hai ${name} ⭐

Yaha aap tasks complete karke real rewards kama sakte ho!

🔥 Daily Tasks
🔥 Video Watch
🔥 Mini Apps
🔥 Referral Bonus
🔥 Auto Wallet System

Ready to earn?
Tap START and your journey begins!
`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "▶ App Kholein", web_app: { url: WEB_APP_URL } } 
            ],
            [
                { text: "📢 Channel", url: "https://t.me/finisher_tech" }
            ],
            [
                { text: "🌐 Community", url: "https://t.me/finisher_techg" }
            ]
        ]
    };

    try {
        await bot.sendPhoto(chatId, WELCOME_IMAGE_URL, {
            caption: welcomeCaption,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } catch {
        await bot.sendMessage(chatId, welcomeCaption, {
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }

    // referral link message removed intentionally
});


// ==============================
// 🌐 HTTP ENDPOINT: /frontend-open (Real-time update)
// ==============================
app.post("/frontend-open", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "userId gayab hai" }); 

        const userRef = doc(db, "users", String(userId));
        const snap = await getDoc(userRef);

        if (!snap.exists()) return res.json({ ok: false, msg: "Upyogakarta nahi mila" }); 

        const data = snap.data();

        // 1. FrontendOpened ko TRUE set karein
        if (!data.frontendOpened) {
            await updateDoc(userRef, { frontendOpened: true });
        }

        // 2. Eligibility Check: Agar refferBy set hai AND rewardgiven FALSE hai, toh turant reward de dein (optional, worker will catch it too)
        if (data.refferBy && !data.rewardgiven) {
            await grantRewardAndMarkComplete(userId, data.refferBy);
            return res.json({ ok: true, msg: "Reward safaltapoorvak diya gaya" });
        } else {
            // Agar refferBy null hai YA reward pehle hi diya ja chuka hai
            return res.json({ ok: true, msg: "Worker check karega ya reward pehle hi mil chuka hai." });
        }

    } catch (err) {
        console.error("frontend-open mein error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});


// ==============================
// 🧠 WORKER FALLBACK (Har 5 second mein chalta hai)
// ==============================
async function referralWorker() {
    const usersRef = collection(db, "users");

    // Query: Sirf woh users jinke liye frontendOpened=true hai
    const q = query(
        usersRef,
        where("frontendOpened", "==", true) 
    );

    try {
        const snaps = await getDocs(q);

        snaps.forEach(async (docSnap) => {
            const data = docSnap.data();
            const userId = docSnap.id;
            const referrerId = data.refferBy; 

            // Eligibility Check:
            // Condition 1: refferBy set hona chahiye.
            // Condition 2: rewardgiven FALSE hona chahiye.
            if (referrerId && !data.rewardgiven) {
                // Reward dein aur mark complete karein
                await grantRewardAndMarkComplete(userId, referrerId);
            } else {
                 // Agar refferBy null hai YA rewardgiven TRUE hai, toh sirf frontendOpened ko reset karein
                 // Taki woh dobara worker query mein na aaye (performance cleanup).
                 await updateDoc(doc(db, "users", String(userId)), { frontendOpened: false });
            }
        });
    } catch(e) {
        console.error("Worker Error: Kripya is query ke liye Firestore Index banana sunischit karein."); 
    }
}

setInterval(referralWorker, 5000);

// ==============================
// 🌍 SERVER START
// ==============================
app.get("/", (req, res) => {
    res.send("Backend Chal raha hai ✔️");
});

app.listen(PORT, () => console.log(`🚀 Backend chal raha hai ${PORT} par`));