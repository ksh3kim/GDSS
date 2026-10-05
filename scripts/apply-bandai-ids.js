/**
 * Bandai Manual ID 매핑 적용 스크립트
 * 
 * 사용법:
 * 1. bandai-id-mapping.csv의 bandai_manual_id 열을 채웁니다
 * 2. 이 스크립트를 Node.js로 실행합니다: node apply-bandai-ids.js
 * 
 * 이 스크립트는:
 * - CSV에서 매핑을 읽어옵니다
 * - gunpla-index.json의 각 제품에 bandaiManualId 필드를 기록합니다
 * - 각 detail JSON 파일에 같은 bandaiManualId 필드를 기록합니다
 *
 * 주의: 반다이 매뉴얼 ID와 gunpla.fyi 박스아트 이미지 ID는 서로 다른 번호 체계입니다.
 * 이 스크립트는 이미지 URL(thumbnail / images.boxart)을 건드리지 않습니다.
 * 상세 페이지는 bandaiManualId가 있으면 manual.bandai-hobby.net/menus/detail/{id}로
 * 바로 연결합니다. 자동 탐색은 resolve-manual-ids.mjs를 사용하세요.
 */

const fs = require('fs');
const path = require('path');

// 경로 설정
const SCRIPT_DIR = __dirname;
const DATA_DIR = path.join(SCRIPT_DIR, '..', 'data');
const CSV_PATH = path.join(SCRIPT_DIR, 'bandai-id-mapping.csv');
const INDEX_PATH = path.join(DATA_DIR, 'gunpla-index.json');
const DETAILS_DIR = path.join(DATA_DIR, 'gunpla-details');

/**
 * bandaiManualId를 modelNumber 바로 뒤에 넣어 키 순서를 유지
 */
function withManualId(obj, manualId) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (k === 'bandaiManualId') continue;
        out[k] = v;
        if (k === 'modelNumber') out.bandaiManualId = manualId;
    }
    if (!('bandaiManualId' in out)) out.bandaiManualId = manualId;
    return out;
}

/**
 * CSV 파일 파싱
 */
function parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    const headers = lines[0].split(',');

    const mappings = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const entry = {};
        headers.forEach((header, index) => {
            entry[header.trim()] = values[index] ? values[index].trim() : '';
        });
        mappings.push(entry);
    }

    return mappings;
}

/**
 * 메인 함수
 */
function main() {
    console.log('🚀 Bandai Manual ID 매핑 적용 시작...\n');

    // CSV 파일 읽기
    if (!fs.existsSync(CSV_PATH)) {
        console.error('❌ CSV 파일을 찾을 수 없습니다:', CSV_PATH);
        process.exit(1);
    }

    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const mappings = parseCSV(csvContent);

    // 유효한 매핑 필터링 (bandai_manual_id가 있는 것만)
    const validMappings = mappings.filter(m => m.bandai_manual_id && m.bandai_manual_id.length > 0);

    if (validMappings.length === 0) {
        console.log('⚠️  bandai_manual_id가 입력된 항목이 없습니다.');
        console.log('   CSV 파일의 bandai_manual_id 열을 채워주세요.');
        process.exit(0);
    }

    console.log(`📋 총 ${mappings.length}개 제품 중 ${validMappings.length}개의 매핑 발견\n`);

    // ID별 매핑 테이블 생성 (매뉴얼 ID는 숫자만 허용)
    const idToManualId = {};
    validMappings.forEach(m => {
        if (!/^\d+$/.test(m.bandai_manual_id)) {
            console.log(`   ⚠️  ${m.id}: bandai_manual_id "${m.bandai_manual_id}"는 숫자가 아니라 건너뜁니다`);
            return;
        }
        idToManualId[m.id] = m.bandai_manual_id;
    });

    // 1. gunpla-index.json 업데이트
    console.log('📝 gunpla-index.json 업데이트 중...');
    const indexContent = fs.readFileSync(INDEX_PATH, 'utf-8');
    const indexData = JSON.parse(indexContent);

    let indexUpdated = 0;
    indexData.products = indexData.products.map(product => {
        const manualId = idToManualId[product.id];
        if (!manualId || product.bandaiManualId === manualId) return product;
        indexUpdated++;
        console.log(`   ✅ ${product.id}: bandaiManualId=${manualId}`);
        return withManualId(product, manualId);
    });

    fs.writeFileSync(INDEX_PATH, JSON.stringify(indexData, null, 4) + '\n', 'utf-8');
    console.log(`   → ${indexUpdated}개 제품 업데이트 완료\n`);

    // 2. detail JSON 파일들 업데이트
    console.log('📝 상세 JSON 파일 업데이트 중...');
    let detailUpdated = 0;

    for (const [id, manualId] of Object.entries(idToManualId)) {
        const detailPath = path.join(DETAILS_DIR, `${id}.json`);

        if (fs.existsSync(detailPath)) {
            const detailContent = fs.readFileSync(detailPath, 'utf-8');
            const detailData = JSON.parse(detailContent);

            if (detailData.bandaiManualId !== manualId) {
                fs.writeFileSync(detailPath, JSON.stringify(withManualId(detailData, manualId), null, 4) + '\n', 'utf-8');
                detailUpdated++;
                console.log(`   ✅ ${id}.json 업데이트`);
            }
        } else {
            console.log(`   ⚠️  ${id}.json 파일 없음 (스킵)`);
        }
    }

    console.log(`   → ${detailUpdated}개 상세 파일 업데이트 완료\n`);

    // 결과 요약
    console.log('═'.repeat(50));
    console.log('🎉 완료!');
    console.log(`   - Index 업데이트: ${indexUpdated}개`);
    console.log(`   - Detail 업데이트: ${detailUpdated}개`);
    console.log('═'.repeat(50));
}

// 실행
main();
