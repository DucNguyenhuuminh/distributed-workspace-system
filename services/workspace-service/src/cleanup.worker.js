const cron = require('node-cron');
const Folder = require('./models/folder.model');
const Workspace = require('./models/workspace.model');

cron.schedule('30 2 * * *', async () => {
    console.log('[Cleanup worker] Start cleaning trash............');
    const tenDaysAgo = new Date() - 10*24*60*60*1000;

    try {
        const folderDel = await Folder.deleteMany({
            deletedAt: {$lt: tenDaysAgo}
        });
        const workspaceDel = await Workspace.deleteMany({
            deletedAt: {$lt: tenDaysAgo}
        });

        console.log(`[Cleanup worker] Cleaned ${folderDel.deletedCount} folders.`);
        console.log(`[Cleanup worker] Cleaned ${workspaceDel.deletedCount} workspaces.`);
    } catch(err) {
        console.error('[Cleanup worker] Error:', err.message);
    }
})