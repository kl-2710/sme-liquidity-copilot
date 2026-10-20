/* Configuration parameters of SRS Appendix C (Table C-1), the threshold table fob.threshold.v3 (workbook v10 sheet Nguong) and the
   Miller–Orr reserve parameters (SRS 2.8.9).
   Every rule in js/engine.js reads its constants from here; nothing is hard-coded in the rules themselves.
   source: verified_reference = industry data (FiinTrade 2016–2025), owner_policy = approved by the company,
   demo_assumption = demonstration default that the company must confirm. */
const CFG={
  versions:{formula:'uc0102.formulas.v1.3',threshold:'fob.threshold.v3',config:'cfg.defaults.v1'},
  // UC01 aggregate thresholds by business model (Table 2-28). DSO/DIO: reference P50, watch P75, severe P90.
  // Full precision of the workbook v9 sheet Nguong (rows 5-22); rounding them would move E_AR / E_INV by millions.
  wc:{
    thr:{
      CMT:{dso:{ref:26.27016744,watch:35.8290068554972,severe:45.9584059232531},dio:{ref:7.1334971105,watch:9.46889728525,severe:13.7015882191},
        dpo:{low:2.63718419871133,high:11.9014270205264},bufThin:.161181709909933},
      // fob.threshold.v3 (workbook v10 sheet Nguong rows 14-22, FiinTrade 2023–2025, 20 FOB garment makers): DSO/DIO P50/P75/P90,
      // DPO low P10 and high P75 (info only), thin cash buffer P25 of (cash + short-term investments) / revenue.
      FOB:{dso:{ref:43.24705229,watch:58.2071385175,severe:66.26326635},dio:{ref:69.751755075,watch:86.118055065,severe:137.965147652},
        dpo:{low:14.892652922,high:68.3092044425},bufThin:.0830079952170207}
    },
    materiality:.05,            // wc.materiality_share (owner_policy default)
    factorSize:1,factorSeason:1,
    defaultModel:'FOB'          // used when the business model is not declared (labelled, see engine)
  },
  ar:{rhoWatch:.5,rhoSevere:1.0,lookbackDays:180,minHistory:5,termFallbackDays:30},
  inv:{slowDays:{NVL:60,HH:60,BTP:30,TP:30},unknownTypeSlowDays:60,collateralTypes:['NVL','TP','HH']},
  ap:{rhoWatch:.5},
  // Counterparty labels (cl.*) and bottleneck parameters (bn.*).
  cl:{newDays:60,regularMinInvoices:12,regularMinMonths:4,largeShare:.30,smallShare:.15,bandSharePP:.02,
    lateFrequentDays:10,bandLateDays:1,overdueLongDays:30,behaviourMinPaid:3,lateConclusionMinPaid:5,
    supplierDependency:.30,supplierShortTermDays:30,extDays:[15,30]},
  bn:{nearThresholdRatio:.9,concentrationShare:.5,rankOrder:['AR','INV','AP']},
  // Company size (Table 2-46, Decree 80/2021): annual revenue caps in VND.
  size:{micro:3e9,small:50e9,medium:200e9},
  // UC02 reserve reference (Table 2-85): cash buffer percentiles × business-model factor, share of 12-month revenue.
  liq:{
    reference:{CMT:{rmin:.1611817099099339,rtarget:.311013635392693,rupper:.5782255225792152},FOB:{rmin:.0532,rtarget:.1026,rupper:.1908}}, // CMT: Nguong rows 53-55
    rminDefaultRatio:.5,rupperDefaultRatio:2,criticalDays:{rmin:[15,20],rtarget:[30,45]},
    // Miller–Orr reserve levels (SRS 2.8.9, Tables 2-68/2-69, Appendix B CF01–CF04; workbook v10 Nguong rows 5-12), version fob.threshold.v3.
    // L = MAX(lowerRatio × 12-month revenue; owner floor); D = (3 b σ² / (4 i))^(1/3) with i = r / 365 (simple rate); Z = L + D; H = L + 3D.
    // σ² is the sample variance of the company's own daily net cash flows (≥ minDailyObs days within 3 years), else the industry proxy
    // sigmaDailyRatio × 12-month revenue (labelled provisional). The old names stay as aliases: rmin = L, rtarget = Z, rupper = H.
    // F01 at 20/06/2026: L 5.350,2 / Z 6.633,1 / H 9.198,9 million VND.
    millerOrr:{version:'fob.threshold.v3',lowerRatio:.0417986209613163,lowerMinOwner:0,transactionCost:1e6,rateAnnual:.0475,daysPerYear:365,
      minDailyObs:90,maxHistoryDays:1095,sigmaDailyRatio:.0025058914001347397}
  },
  tv2:{horizonWeeks:13,delay:{lookbackDays:180,minN:5,defaultLate:7,conditionalMinN:3},
    overdueResidual:{optimistic:3,base:10,conservative:21},apOverdueOffset:{conservative:1,base:5,optimistic:10},
    stressDays:7,th03MinConsecutiveDays:14,persistentShortfallMinBlocks:2,blockDays:14,tolerance:1},
  fb:{rerunDays:7,minMatched:20,wape:{watch:.25,degraded:.40},bias:{watch:.10,degraded:.20},cashError:{watch:.10,degraded:.25},
    bandCoverage:{watch:.80,degraded:.60},consecutiveRuns:2,shiftDays:7,shiftMinInvoices:3,recentN:5},
  erp:{freshMaxHours:24,staleHours:72},
  ui:{evidencePageSize:50,evidenceMaxRows:200},
  // Inventory-backed loan minimum used for the collateral check (INV-001, demo assumption).
  collateralMin:500e6
};
// Where each threshold comes from; shown next to every threshold in the dashboard.
const THRESHOLD_SOURCE={
  verified_reference:'Garment industry benchmark, FiinTrade 2016–2025',
  owner_policy:'Company policy',
  firm_profile:'Company profile (declared by the owner)',
  demo_assumption:'Demo assumption'
};
// Hidden upload aliases: the Vietnamese column headers, cell values and name keywords that uploaded files may use. This array is the
// only Vietnamese text in the app; it is never shown. [alias, canonical, kind]: col = column header, val = cell value,
// lot / owner / cancel / supplier = keyword in a lot or supplier name (matched without accents, like the English keywords).
const UPLOAD_ALIASES=[
  ['Mã số thuế','tax_code','col'],['MST','tax_code','col'],['Loại hàng','inventory_type','col'],['Loại tồn kho','inventory_type','col'],['Chủ sở hữu','owner','col'],
  ['Đã hủy','cancelled','col'],['Cầm cố','pledged','col'],['Thiết yếu','essential','col'],['Số tiền đã thu','paid_amount','col'],['Số tiền đã trả','paid_amount','col'],
  ['Ngày','date','col'],['Mức chắc chắn','certainty','col'],['Tài sản ngắn hạn','current_assets_vnd','col'],['Mô hình kinh doanh','business_model','col'],
  ['Số tiền','amount_vnd','col'],['Giá trị','amount_vnd','col'],['Khách hàng','buyer','col'],['Nhà cung cấp','supplier','col'],['Ngày phát hành','issue_date','col'],
  ['Ngày lập','issue_date','col'],['Hạn thanh toán','due_date','col'],['Ngày đến hạn','due_date','col'],['Ngày thanh toán','paid_date','col'],['Số hóa đơn','invoice_id','col'],
  ['Mã hóa đơn','invoice_id','col'],['Tên hàng','product_line','col'],['Mặt hàng','product_line','col'],['Số lượng','qty','col'],['Đơn giá','unit_cost_vnd','col'],
  ['Số ngày tồn','days_in_stock','col'],['Doanh thu','revenue_vnd','col'],['Giá vốn','cogs_vnd','col'],['Tiền đầu kỳ','opening_cash_vnd','col'],['Tuần','week','col'],
  ['Hạng mục','category','col'],['Tên','name','col'],['Ngành','industry','col'],['Tiền đệm tối thiểu','min_cash_buffer_vnd','col'],
  ['có','yes','val'],['không','no','val'],['ngày','days','val'],['đ','vnd','val'],['gia công','CMT','val'],
  ['bán thành phẩm','BTP','lot'],['dở dang','BTP','lot'],['thành phẩm','TP','lot'],['chờ xuất','TP','lot'],['hàng hóa','HH','lot'],
  ['nguyên','NVL','lot'],['phụ liệu','NVL','lot'],['vải','NVL','lot'],['chỉ','NVL','lot'],['nút','NVL','lot'],['khóa','NVL','lot'],['giấy','NVL','lot'],['mực','NVL','lot'],['keo','NVL','lot'],
  ['giao để gia công','customer','owner'],['hàng gia công','customer','owner'],['nhận gia công','customer','owner'],['hủy','cancelled','cancel'],
  ['thông quan','logistics_customs','supplier'],['điện','utilities','supplier'],['nước','utilities','supplier'],['vận tải','transport','supplier'],
  ['phụ liệu','trims_packaging','supplier'],['bao bì','trims_packaging','supplier'],['mực in','trims_packaging','supplier'],['chỉ','trims_packaging','supplier'],
  ['nút','trims_packaging','supplier'],['khóa','trims_packaging','supplier'],['vải','main_material','supplier'],['giấy cuộn','main_material','supplier'],['sợi','main_material','supplier']
];
