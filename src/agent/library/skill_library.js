import { cosineSimilarity } from '../../utils/math.js';
import { getSkillDocs } from './index.js';
import { rankByKeywords } from '../../utils/keyword_rank.js';

// Text used to rank a doc by keywords: the lines of the doc up to the first @param, @returns or @example line.
export function docSearchText(doc) {
    if (typeof doc !== 'string')
        return '';
    const lines = [];
    for (const line of doc.split(/\r?\n/)) {
        if (line.includes('@param') || line.includes('@returns') || line.includes('@return') || line.includes('@example'))
            break;
        lines.push(line);
    }
    return lines.join(' ');
}

export class SkillLibrary {
    constructor(agent,embedding_model) {
        this.agent = agent;
        this.embedding_model = embedding_model;
        this.skill_docs_embeddings = {};
        this.skill_docs = null;
        this.always_show_skills = ['skills.placeBlock', 'skills.wait', 'skills.breakBlockAt']
    }
    async initSkillLibrary(docs = getSkillDocs()) {
        this.skill_docs = docs;
        if (this.embedding_model) {
            try {
                // collect all embeddings first, so a failure cannot leave a partial set behind
                const embeddings = await Promise.all(docs.map((doc) => {
                    let func_name_desc = doc.split('\n').slice(0, 2).join('');
                    return this.embedding_model.embed(func_name_desc);
                }));
                docs.forEach((doc, i) => {
                    this.skill_docs_embeddings[doc] = embeddings[i];
                });
            } catch (error) {
                console.warn('Error with embedding model, using word-overlap instead.');
                this.embedding_model = null;
                this.skill_docs_embeddings = {};
            }
        }
        this.always_show_skills_docs = {};
        for (const skillName of this.always_show_skills) {
            this.always_show_skills_docs[skillName] =
                this.skill_docs.find(doc => doc.split('\n')[0] === skillName) ||
                this.skill_docs.find(doc => doc.includes(skillName));
        }
    }

    async getAllSkillDocs() {
        return this.skill_docs;
    }

    async getRelevantSkillDocs(message, select_num) {
        if(!message) // use filler message if none is provided
            message = '(no message)';
        const docs = this.skill_docs || [];
        const hasEmbedding = (doc) =>
            Object.prototype.hasOwnProperty.call(this.skill_docs_embeddings, doc) && this.skill_docs_embeddings[doc] != null;
        let ranked_docs = [];

        if (select_num === -1) {
            ranked_docs = docs.slice();
        }
        else if (select_num === 0) {
            ranked_docs = [];
        }
        else if (!this.embedding_model || !docs.every(hasEmbedding)) {
            ranked_docs = rankByKeywords(message, docs, docSearchText).map(result => result.item);
        }
        else {
            let latest_message_embedding = await this.embedding_model.embed(message);
            ranked_docs = docs
                .map(doc => ({
                    doc,
                    similarity_score: cosineSimilarity(latest_message_embedding, this.skill_docs_embeddings[doc])
                }))
                .sort((a, b) => b.similarity_score - a.similarity_score)
                .map(result => result.doc);
        }

        let length = ranked_docs.length;
        if (select_num === -1 || select_num > length) {
            select_num = length;
        }
        // Get initial docs from the ranking
        let selected_docs = new Set(ranked_docs.slice(0, select_num));
        
        // Add always show docs
        Object.values(this.always_show_skills_docs || {}).forEach(doc => {
            if (doc) {
                selected_docs.add(doc);
            }
        });
        
        let relevant_skill_docs = '#### RELEVANT CODE DOCS ###\nThe following functions are available to use:\n';
        relevant_skill_docs += Array.from(selected_docs).join('\n### ');

        console.log('Selected skill docs:', Array.from(selected_docs).map(doc => {
            const first_line_break = doc.indexOf('\n');
            return first_line_break > 0 ? doc.substring(0, first_line_break) : doc;
        }));
        return relevant_skill_docs;
    }
}
