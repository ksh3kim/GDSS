// Model number mapping for all Gunpla products
const modelNumberMap = {
    "hg-rx-78-2-revive": "RX-78-2",
    "rg-rx-78-2": "RX-78-2",
    "mg-rx-78-2-ver3": "RX-78-2",
    "pg-rx-78-2": "RX-78-2",
    "pgu-rx-78-2": "RX-78-2",
    "eg-rx-78-2": "RX-78-2",
    "hg-unicorn-destroy": "RX-0",
    "hg-unicorn-unicorn": "RX-0",
    "rg-unicorn": "RX-0",
    "mg-unicorn-verka": "RX-0",
    "hg-freedom-revive": "ZGMF-X10A",
    "rg-freedom": "ZGMF-X10A",
    "mg-freedom-ver2": "ZGMF-X10A",
    "hg-strike-freedom": "ZGMF-X20A",
    "rg-strike-freedom": "ZGMF-X20A",
    "hg-exia": "GN-001",
    "rg-exia": "GN-001",
    "mg-exia": "GN-001",
    "hg-00-raiser": "GN-0000+GNR-010",
    "rg-00-raiser": "GN-0000+GNR-010",
    "hg-barbatos": "ASW-G-08",
    "hg-barbatos-lupus-rex": "ASW-G-08",
    "fm-barbatos-lupus-rex": "ASW-G-08",
    "hg-aerial": "XVX-016",
    "hg-aerial-rebuild": "XVX-016RN",
    "hg-calibarn": "XVX-016RN/カリバーン",
    "hg-wing-zero-ew": "XXXG-00W0",
    "rg-wing-zero-ew": "XXXG-00W0",
    "mg-wing-zero-ew-verka": "XXXG-00W0",
    "hg-nu-gundam": "RX-93",
    "rg-nu-gundam": "RX-93",
    "mg-nu-gundam-verka": "RX-93",
    "rg-sazabi": "MSN-04",
    "mg-sazabi-verka": "MSN-04",
    "hg-sinanju": "MSN-06S",
    "rg-sinanju": "MSN-06S",
    "mg-sinanju-verka": "MSN-06S",
    "hg-zaku-ii": "MS-06F",
    "rg-zaku-ii": "MS-06F",
    "mg-zaku-ii-ver2": "MS-06F",
    "rg-char-zaku": "MS-06S",
    "sd-rx-78-2": "RX-78-2",
    "sdex-strike": "GAT-X105",
    "mgex-unicorn": "RX-0",
    "hg-rising-freedom": "STTS-909",
    "hg-mighty-strike-freedom": "STTS-808",
    "hg-destiny-spec2": "ZGMF-X42S"
};

const fs = require('fs');

// Read the file
const data = JSON.parse(fs.readFileSync('data/gunpla-index.json', 'utf8'));

// Update each product
data.products.forEach(product => {
    if (modelNumberMap[product.id]) {
        product.modelNumber = modelNumberMap[product.id];
    }
});

// Write back
fs.writeFileSync('data/gunpla-index.json', JSON.stringify(data, null, 4), 'utf8');

console.log('Updated', data.products.length, 'products with model numbers');
