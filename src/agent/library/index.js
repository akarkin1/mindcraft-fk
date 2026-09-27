import * as skills from './skills.js';
import * as world from './world.js';


export function docHelper(functions, module_name) {
    let docArray = [];
    for (let skillFunc of functions) {
        let str = skillFunc.toString();
        const docStart = str.indexOf('/**');
        if (docStart === -1) continue;
        // the doc ends at the first */ after the opening, whether it is written */ or **/
        const docEnd = str.indexOf('*/', docStart + 3);
        if (docEnd === -1) continue;
        let docText = str.substring(docStart + 3, docEnd);
        if (docText.endsWith('*')) // terminator was **/
            docText = docText.slice(0, -1);
        let docEntry = `${module_name}.${skillFunc.name}\n`;
        docEntry += docText.trim();
        docArray.push(docEntry);
    }
    return docArray;
}

export function getSkillDocs() {
    let docArray = [];
    docArray = docArray.concat(docHelper(Object.values(skills), 'skills'));
    docArray = docArray.concat(docHelper(Object.values(world), 'world'));
    return docArray;
}
