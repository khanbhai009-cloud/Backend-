/**
 * Node.js Telegram Bot Backend
 * Features:
 * - Telegram bot in polling mode (node-telegram-bot-api)
 * - Firebase Firestore Client SDK
 * - Express server for basic health check
 * - /start command handler with referral logic
 * - Interval-based worker for referral rewards (since Client SDK onSnapshot is unreliable in Node.js)
 */

// --- 1. CONFIGURATION AND INITIALIZATION ---

// Environment Variable for Telegram Bot Token
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
if (BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error("WARNING: BOT_TOKEN is not set. Using placeholder.");
}

// Referral Reward Constant
const REWARD_AMOUNT = 500; // Coins to give to the referrer

// Firebase Client Configuration Placeholder
// NOTE: For security in production, this should ideally be in a secure environment config.
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Import and Initialize Firebase Client SDK
import { initializeApp } from "firebase/app";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, increment, serverTimestamp, collection, query, where, getDocs 
} from "firebase/firestore";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Import and Initialize Telegram Bot
import TelegramBot from 'node-telegram-bot-api';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Telegram Bot started in polling mode...');

// Import and Initialize Express
import express from 'express';
const expressApp = express();
const PORT = process.env.PORT || 3000;

// --- 2. FIRESTORE HELPER FUNCTIONS ---

/**
 * Ensures a user document exists or merges/updates existing data.
 * @param {number} userId - Telegram user ID.
 * @param {string} firstName - Telegram user first name.
 * @param {string} photoURL - Placeholder for user photo URL.
 * @param {string|null} referralId - ID of the referrer, or null.
 */
async function createOrEnsureUser(userId, firstName, photoURL, referralId) {
    const userRef = doc(db, "users", String(userId));
    
    // Default structure for a new or existing user (merge: true will only update fields provided)
    const userData = {
        id: userId,
        name: firstName || "User",
        photoURL: photoURL || null,
        // Only set these initial values if the document is new or if we're setting the referral info
        // We use merge:true so existing coins/tasks/etc. are preserved.
    };

    // Only set refferBy if it's provided AND the field doesn't already exist in the database
    // This is important to prevent re-assignment of the referrer.
    if (referralId) {
        // Fetch existing document to check if refferBy is already set
        const docSnap = await getDoc(userRef);
        if (docSnap.exists() && docSnap.data().refferBy !== null) {
            console.log(`User ${userId} already has a referrer set (${docSnap.data().refferBy}). Skipping update.`);
        } else {
            // Set initial state for new users OR update refferBy for existing users without one
            Object.assign(userData, {
                coins: 0,
                reffer: 0,
                refferBy: referralId,
                tasksCompleted: 0,
                totalWithdrawals: 0,
                frontendOpened: false,
                rewardGiven: false,
            });
            console.log(`User ${userId} created/updated with referrer: ${referralId}`);
        }
    } else {
        // Set initial state for new users without a referrer
        Object.assign(userData, {
            coins: 0,
            reffer: 0,
            refferBy: null,
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false,
            rewardGiven: false,
        });
        console.log(`User ${userId} created/updated without referrer.`);
    }

    // Use setDoc with { merge: true } to create the document if it doesn't exist,
    // or merge the new data with the existing document if it does.
    await setDoc(userRef, userData, { merge: true });
}

/**
 * Updates a single field in the user document.
 * @param {number} userId - Telegram user ID.
 * @param {string} field - Field name to update.
 * @param {*} value - New value for the field.
 */
async function updateField(userId, field, value) {
    const userRef = doc(db, "users", String(userId));
    await updateDoc(userRef, {
        [field]: value
    });
    console.log(`Updated user ${userId}: ${field} = ${value}`);
}

/**
 * Increments a numeric field in the user document.
 * @param {number} userId - Telegram user ID.
 * @param {string} field - Field name to increment.
 * @param {number} amount - Amount to increment by.
 */
async function incrementField(userId, field, amount) {
    const userRef = doc(db, "users", String(userId));
    await updateDoc(userRef, {
        [field]: increment(amount)
    });
    console.log(`Incremented user ${userId}: ${field} by ${amount}`);
}


/**
 * Core logic to reward the referrer of a user.
 * @param {string} userId - ID of the user (B) who completed the action.
 * @param {string} referrerId - ID of the user (A) who referred B.
 */
async function rewardReferrer(userId, referrerId) {
    const userBRef = doc(db, "users", String(userId));
    const userARef = doc(db, "users", String(referrerId));
    const refRewardRef = doc(db, "ref_rewards", String(userId)); // Use userB's ID as doc ID

    try {
        // 1. Increment referrer (A)'s coins and reffer count
        await updateDoc(userARef, {
            coins: increment(REWARD_AMOUNT),
            reffer: increment(1)
        });
        console.log(`Successfully rewarded referrer ${referrerId} with ${REWARD_AMOUNT} coins and incremented reffer count.`);

        // 2. Set user (B)'s rewardGiven = true
        await updateDoc(userBRef, {
            rewardGiven: true
        });
        console.log(`Successfully marked user ${userId} as rewardGiven=true.`);
        
        // 3. Create ledger entry in ref_rewards
        await setDoc(refRewardRef, {
            userId: String(userId),
            referrerId: String(referrerId),
            reward: REWARD_AMOUNT,
            createdAt: serverTimestamp()
        });
        console.log(`Successfully created ref_rewards ledger for user ${userId}.`);

    } catch (error) {
        console.error(`Error processing reward for user ${userId} (referrer ${referrerId}):`, error);
        // NOTE: In a real app, robust error handling and transactionality would be required.
    }
}


// --- 3. REFERRAL WORKER LOGIC (INTERVAL BASED) ---

/**
 * Interval-based worker to check for and process pending referral rewards.
 * Checks for users where: frontendOpened=true, rewardGiven=false, and refferBy!=null.
 */
async function referralRewardWorker() {
    console.log('--- Starting Referral Reward Worker Check ---');
    try {
        const usersCol = collection(db, "users");
        
        // Build the query to find eligible users (B)
        const q = query(
            usersCol,
            where("frontendOpened", "==", true),
            where("rewardGiven", "==", false),
            where("refferBy", "!=", null) // refferBy must exist
        );

        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            console.log('No eligible users found for referral reward.');
            return;
        }

        console.log(`Found ${querySnapshot.size} user(s) eligible for referral reward.`);

        const rewardPromises = [];

        querySnapshot.forEach((docSnap) => {
            const userData = docSnap.data();
            const userId = docSnap.id;
            const referrerId = userData.refferBy;
            
            console.log(`Processing reward for user ${userId} (referred by ${referrerId})`);
            
            // Queue the reward logic
            rewardPromises.push(rewardReferrer(userId, referrerId));
        });

        await Promise.all(rewardPromises);
        console.log('--- Referral Reward Worker Check Complete ---');

    } catch (error) {
        console.error("Error in referralRewardWorker:", error);
    }
}

// Start the worker to run every 500ms
setInterval(referralRewardWorker, 500);
console.log('Referral Reward Worker started (interval: 500ms)...');


// --- 4. TELEGRAM BOT HANDLERS ---

/**
 * Handles the /start command.
 * 1. Extracts user info and referral ID.
 * 2. Creates/updates user in Firestore.
 * 3. Sends welcome message and buttons.
 */
bot.onText(/\/start ?(.*)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    // Note: photo_url is not directly available on 'msg.from'. It requires a separate API call (getUserProfilePhotos).
    const photoURL = `https://t.me/i/userpic/${userId}`; // Placeholder or use null

    // Extract referral ID: /start ref123 -> "123"
    let referralId = null;
    if (match && match[1]) {
        const payload = match[1].trim();
        const refMatch = payload.match(/^ref(\d+)/);
        if (refMatch) {
            referralId = refMatch[1];
        }
    }
    
    // Check if the user is trying to refer themselves
    if (referralId && String(userId) === referralId) {
        referralId = null;
        console.log(`User ${userId} attempted self-referral. Blocked.`);
    }

    try {
        // 1. Create or merge Firestore document
        await createOrEnsureUser(userId, firstName, photoURL, referralId);

        // 2. Prepare welcome message
        const welcomeCaption = 
`👋 Hi! Welcome **${firstName}** ⭐
Yaha aap tasks complete karke real rewards kama sakte ho!

🔥 Daily Tasks
🔥 Video Watch
🔥 Mini Apps
🔥 Referral Bonus
🔥 Auto Wallet System

Ready to earn?
Tap START and your journey begins!`;

        const welcomeImage = 'https://i.ibb.co/932298pT/file-32.jpg';

        // 3. Send image with buttons
        const keyboard = {
            inline_keyboard: [
                [{ text: "▶ Open App", web_app: { url: "https://khanbhai009-cloud.github.io/Tg-bot" } }],
                [{ text: "📢 Channel", url: "https://t.me/finisher_tech" }],
                [{ text: "🌐 Community", url: "https://t.me/finisher_techg" }]
            ]
        };

        bot.sendPhoto(chatId, welcomeImage, {
            caption: welcomeCaption,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });

    } catch (error) {
        console.error('Error handling /start command:', error);
        bot.sendMessage(chatId, "Sorry, there was an error processing your request. Please try again later.");
    }
});


// --- 5. EXPRESS SERVER (HEALTH CHECK) ---

expressApp.get('/', (req, res) => {
    // Simple response to show the server is running
    res.send('Telegram Bot Backend is running and polling.');
});

expressApp.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
});

// --- END OF FILE ---
              
