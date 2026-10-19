/* Configuration parameters of SRS v1.3 Appendix C (Table C-1) and the threshold table 2-28 (tv1.threshold.v2).
   Every rule in js/engine.js reads its constants from here; nothing is hard-coded in the rules themselves.
   source: verified_reference = industry data (FiinTrade 2016–2025), owner_policy = approved by the company,
   demo_assumption = demonstration default that the company must confirm. */
const CFG={
  versions:{formula:'uc0102.formulas.v1.3',threshold:'tv1.threshold.v2',config:'cfg.defaults.v1'},
  // UC01 aggregate thresholds by business model (Table 2-28). DSO/DIO: reference P50, watch P75, severe P90.
  wc:{
    thr:{
      CMT:{dso:{ref:26.3,watch:35.8,severe:46.0},dio:{ref:7.1,watch:9.5,severe:13.7},dpo:{low:2.6,high:11.9},bufThin:.161},
      FOB:{dso:{ref:41.6,watch:56.7,severe:72.8},dio:{ref:74.2,watch:98.4,severe:142.4},dpo:{low:13.2,high:59.7},bufThin:.053}
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
    reference:{CMT:{rmin:.161,rtarget:.311,rupper:.578},FOB:{rmin:.0532,rtarget:.1026,rupper:.1908}},
    rminDefaultRatio:.5,rupperDefaultRatio:2,criticalDays:{rmin:[15,20],rtarget:[30,45]}
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
  verified_reference:{en:'Garment industry benchmark, FiinTrade 2016–2025',vi:'Chuẩn ngành may, FiinTrade 2016–2025'},
  owner_policy:{en:'Company policy',vi:'Chính sách của doanh nghiệp'},
  firm_profile:{en:'Company profile (declared by the owner)',vi:'Hồ sơ doanh nghiệp (chủ doanh nghiệp khai báo)'},
  demo_assumption:{en:'Demo assumption',vi:'Giả định trình diễn'}
};
