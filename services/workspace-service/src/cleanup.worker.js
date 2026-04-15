const cron = require('node-cron');
const Folder = require('./models/folder.model');

cron.schedule('30 2 * * *', async () => {
    console.log('[Cleanup worker] Start cleaning trash............');
    const tenDaysAgo = new Date() - 10*24*60*60*1000;

    try {
        const folderDel = await Folder.deleteMany({
            deletedAt: {$lt: tenDaysAgo}
        });

        console.log(`[Cleanup worker] Cleaned ${folderDel.deletedCount} folders.`);
    } catch(err) {
        console.error('[Cleanup worker] Error:', err.message);
    }
})