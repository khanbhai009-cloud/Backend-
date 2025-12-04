// ==============================================
// FINAL FIRESTORE BACKEND (Working Code)
// Logic: Reward is granted only when 'frontendOpened' is TRUE.
// After granting, 'frontendOpened' is set back to FALSE to prevent double-dipping.
// ==============================================

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
    getDocs,
    query,
    where,
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
 * Extracts a clean numeric ID from the /start deep link argument.
 */
function extractReferralId(raw) {
    if (!raw) return null;
    // Cleans spaces, '?', '=', and 'ref' (handling both 'ref123' and '?ref=123')
    const clean = raw.replace(/[\s?=]+/g, "").replace("ref", "");
    return clean || null;
}

/**
 * Creates a new user or updates the refferBy field if it was previously null.
 */
async function createOrUpdateUser(userId, name, referralId = null) {
    const refUser = doc(db, "users", String(userId));
    const snap = await getDoc(refUser);

    if (!snap.exists()) {
        // --- NEW USER CREATION ---
        const data = {
            id: String(userId),
            name,
            photoURL: "", // Placeholder
            coins: 0,
            reffer: 0,
            refferBy: referralId || null,
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false, // Default: false
        };
        await setDoc(refUser, data);
        console.log(`🔥 Naya upyogakarta bana: ${userId}`); // New user created
        return data;
    } else {
        // --- EXISTING USER UPDATE (Minimal Update Policy) ---
        let existing = snap.data();
        let updateData = {};
        
        // Agar refferBy null hai aur naya referralId hai, toh update karein.
        if (!existing.refferBy && referralId) {
            updateData.refferBy = referralId;
        }

        if (Object.keys(updateData).length > 0) {
            await updateDoc(refUser, updateData);
            console.log(`ℹ maujooda upyogakarta (refferBy) update hua: ${userId}`); // Existing user updated
            return { ...existing, ...updateData };
        }
        
        console.log(`ℹ maujooda upyogakarta mila: ${userId} (koi update nahi)`); // Existing user found
        return existing;
    }
}

/**
 * Executes the referral reward logic, then resets frontendOpened to FALSE.
 */
async function grantReward(userId, referrerId) {
    if (String(userId) === String(referrerId)) {
        // Self-referral protection: Reset frontendOpened to stop worker checks
        await updateDoc(doc(db, "users", String(userId)), { frontendOpened: false });
        console.warn(`🛑 Khud ka referral prayas roka gaya ${userId} ke liye`); // Self referral attempt blocked
        return;
    }

    // 1. Update Referrer (User A): coins +500, reffer +1
    const refRef = doc(db, "users", String(referrerId));
    await updateDoc(refRef, {
        coins: increment(REWARD_AMOUNT),
        reffer: increment(1)
    });

    // 2. IMPORTANT: Reset User B's frontendOpened to FALSE to prevent double-dipping.
    const userRef = doc(db, "users", String(userId));
    await updateDoc(userRef, {
        frontendOpened: false, 
    });

    // 3. Ledger Entry (Tracking ke liye zaroori)
    await setDoc(doc(db, "ref_rewards", String(userId)), {
        userId: String(userId),
        referrerId: String(referrerId),
        reward: REWARD_AMOUNT,
        createdAt: serverTimestamp()
    });

    // 4. Notify referrer
    try {
        await bot.sendMessage(
            referrerId,
            `🎉 *Referral Bonus!* Aapne *${REWARD_AMOUNT} coins* kamaaye kyunki aapke referral ne app khola!`, // You earned 500 coins because your referral opened the app
            { parse_mode: "Markdown" }
        );
    } catch (e) {
         console.log(`Referrer ko soochit nahi kar saka ${referrerId}`); // Could not notify referrer
    }
    
    console.log(`✅ Reward diya gaya: ${referrerId} -> ${userId}`); // Reward granted
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

    // 2. Welcome message bhejain
    const welcomeCaption = `
👋 Namaste! Swagat hai ${name} ⭐

Yahan aap tasks complete karke real rewards kama sakte ho!

🔥 Roz ke Tasks (Daily Tasks)
🔥 Video Dekhna
🔥 Mini Apps
🔥 Referral Bonus
🔥 Auto Wallet System

**Kamaane ke liye taiyar?**
START dabao aur aapka safar shuru!
`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "▶ App Kholein", web_app: { url: WEB_APP_URL } } // Open App
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

    // 3. Referral Link bhejain
    const me = await bot.getMe();
    await bot.sendMessage(
        chatId,
        `🔗 *Aapka referral link*:\nhttps://t.me/${me.username}?start=ref${chatId}`, // Your referral link
        { parse_mode: "Markdown" }
    );
});


// ==============================
// 🌐 HTTP ENDPOINT: /frontend-open (Real-time reward)
// ==============================
app.post("/frontend-open", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "userId gayab hai" }); // Missing userId

        const userRef = doc(db, "users", String(userId));
        const snap = await getDoc(userRef);

        if (!snap.exists()) return res.json({ ok: false, msg: "Upyogakarta nahi mila" }); // User not found

        const data = snap.data();
        
        // 1. frontendOpened ko TRUE set karein (agar nahi hai)
        if (!data.frontendOpened) {
            await updateDoc(userRef, { frontendOpened: true });
        }

        // 2. Eligibility Check: Agar frontendOpened FALSE hai, toh iska matlab hai reward mil chuka hai.
        if (!data.frontendOpened || !data.refferBy) {
             // Agar frontendOpened FALSE hai, skip karein (dobara reward nahi)
            return res.json({ ok: true, msg: "Pehle hi reward mil chuka hai (frontendOpened FALSE hai) ya koi referrer nahi hai" }); 
        }

        // 3. Reward dein aur frontendOpened ko FALSE par reset karein
        await grantReward(userId, data.refferBy); 

        return res.json({ ok: true, msg: "Reward safaltapoorvak diya gaya" }); // Reward successful

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

    // Query: Sirf woh users jo frontend khol chuke hain (frontendOpened=true)
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
            
            // Agar refferBy null nahi hai (referral se aaya hai), toh reward dein.
            if (referrerId) {
                await grantReward(userId, referrerId);
            }
        });
    } catch(e) {
        console.error("Worker Error: Kripya is query ke liye Firestore Index banana sunischit karein."); // Please ensure Firestore Composite Index is created for this query
    }
}

setInterval(referralWorker, 5000);

// ==============================
// 🌍 SERVER START
// ==============================
app.get("/", (req, res) => {
    res.send("Backend Chal raha hai ✔️"); // Backend Running
});

app.listen(PORT, () => console.log(`🚀 Backend chal raha hai ${PORT} par`)); // Backend running on PORT