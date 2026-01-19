/**
 * Bandai Manual ID 매핑 적용 스크립트
 * 
 * 사용법:
 * 1. bandai-id-mapping.csv의 bandai_manual_id 열을 채웁니다
 * 2. 이 스크립트를 Node.js로 실행합니다: node apply-bandai-ids.js
 * 
 * 이 스크립트는:
 * - CSV에서 매핑을 읽어옵니다
 * - gunpla-index.json의 thumbnail URL을 업데이트합니다
 * - 각 detail JSON 파일의 images.boxart URL을 업데이트합니다
 */

const fs = require('fs');
const path = require('path');

// 경로 설정
const SCRIPT_DIR = __dirname;
const DATA_DIR = path.join(SCRIPT_DIR, '..', 'data');
const CSV_PATH = path.join(SCRIPT_DIR, 'bandai-id-mapping.csv');
const INDEX_PATH = path.join(DATA_DIR, 'gunpla-index.json');
const DETAILS_DIR = path.join(DATA_DIR, 'gunpla-details');

// 이미지 URL 기본 형식
const IMAGE_URL_BASE = 'https://gunpla.fyi/images/boxarts/';

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

    // ID별 매핑 테이블 생성
    const idToManualId = {};
    validMappings.forEach(m => {
        idToManualId[m.id] = m.bandai_manual_id;
    });

    // 1. gunpla-index.json 업데이트
    console.log('📝 gunpla-index.json 업데이트 중...');
    const indexContent = fs.readFileSync(INDEX_PATH, 'utf-8');
    const indexData = JSON.parse(indexContent);

    let indexUpdated = 0;
    indexData.products.forEach(product => {
        if (idToManualId[product.id]) {
            const newUrl = IMAGE_URL_BASE + idToManualId[product.id];
            if (product.thumbnail !== newUrl) {
                product.thumbnail = newUrl;
                indexUpdated++;
                console.log(`   ✅ ${product.id}: ${newUrl}`);
            }
        }
    });

    fs.writeFileSync(INDEX_PATH, JSON.stringify(indexData, null, 4), 'utf-8');
    console.log(`   → ${indexUpdated}개 제품 업데이트 완료\n`);

    // 2. detail JSON 파일들 업데이트
    console.log('📝 상세 JSON 파일 업데이트 중...');
    let detailUpdated = 0;

    for (const [id, manualId] of Object.entries(idToManualId)) {
        const detailPath = path.join(DETAILS_DIR, `${id}.json`);

        if (fs.existsSync(detailPath)) {
            const detailContent = fs.readFileSync(detailPath, 'utf-8');
            const detailData = JSON.parse(detailContent);

            const newUrl = IMAGE_URL_BASE + manualId;

            if (detailData.images && detailData.images.boxart !== newUrl) {
                detailData.images.boxart = newUrl;
                fs.writeFileSync(detailPath, JSON.stringify(detailData, null, 4), 'utf-8');
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
