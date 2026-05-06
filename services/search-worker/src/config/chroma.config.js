const {ChromaClient, DefaultEmbeddingFunction} = require ('chromadb');
const client = new ChromaClient({path: process.env.CHROMA_URL});
const COLLECTION_NAME = 'documents';
const embedFunction = new DefaultEmbeddingFunction();

let collection;

async function initCollection() {
    try {
        collection = await client.getOrCreateCollection({
            name: COLLECTION_NAME, 
            embeddingFunction: embedFunction,
            metadata: {'hnsw:space': 'cosine' },
        });
        console.log(`[ChromaDB] Collection "${COLLECTION_NAME}" ready`);
        return collection;
    } catch(err) {
        console.error(`[ChromaDB] Error to init collection: ${err.message}`);
        throw err;
    }
}

async function upsertDocuments({id, document, metadata}) {
    await collection.upsert({
        ids: [id],
        documents: [document],
        metadatas: [metadata],
    });
}

async function deleteById(id) {
    await collection.delete({ids: [id]});
}

async function deleteByWorkspace(workspaceId) {
    await collection.delete({where: {workspaceId}});
}

async function query({text, nResults=10, where}) {
    return collection.query({
        queryTexts: [text],
        nResults,
        where: where || undefined,
    });
}

module.exports = { initCollection, upsertDocuments, deleteById, deleteByWorkspace, query};