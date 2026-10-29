// 판정 패널 미리보기 픽스처 — 실제 엔진 출력(packages/rules judge + 규칙 팩 2026.10.0)을 그대로 옮긴 값. 손으로 만든 수치가 아니다.
// 데모 프로젝트 3개(packages/features/src/demo/samples.ts)를 judge(model, pack, { pendingChanges: 0 })로 돌린 결과다.
// 규칙 팩 2026.10.0은 전 규칙이 미확인(UNVERIFIED)이라 모든 항목이 WARN이다 — 이것이 현재의 정상 출력이다.
// 다시 만들려면 packages/rules 의 loadRulePack(packs/2026.10.0/pack.json)과 judge를 위 모델에 돌려 같은 모양으로 덮어쓴다.
import type { JudgmentResult } from "@arch-studio/domain";
import type { JudgmentDetailLike, JudgmentWarningLike } from "./model.ts";

export interface EngineOutputFixture {
  readonly projectId: string;
  readonly massIds: readonly string[];
  readonly result: JudgmentResult;
  readonly details: readonly JudgmentDetailLike[];
  readonly warnings: readonly JudgmentWarningLike[];
}

export const ENGINE_OUTPUTS: readonly EngineOutputFixture[] = [
  {
    "projectId": "0192f0a0-1c00-7a01-8a01-000000000001",
    "massIds": [
      "m-house"
    ],
    "result": {
      "engine_version": "rules-0.1.0",
      "rule_pack_version": "2026.10.0",
      "application_date": "2026-12-01",
      "items": [
        {
          "key": "coverage",
          "verdict": "WARN",
          "unit": "pct",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 30.3
        },
        {
          "key": "far",
          "verdict": "WARN",
          "unit": "pct",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 60.61
        },
        {
          "key": "height",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 6300
        },
        {
          "key": "sunlight",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "건축법",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "setback",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 5000
        },
        {
          "key": "setback",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 4000
        },
        {
          "key": "parking",
          "verdict": "WARN",
          "unit": "count",
          "basis": [
            {
              "law": "주차장법 시행령",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "seismic",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "zero_energy",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "supervision",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        }
      ],
      "pending_changes": 0
    },
    "details": [
      {
        "key": "coverage",
        "rule_id": "coverage.national",
        "title": "건폐율",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "far",
        "rule_id": "far.national",
        "title": "용적률",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE",
          "FAR_EXCLUSIONS_UNVERIFIED"
        ]
      },
      {
        "key": "height",
        "rule_id": "height.national",
        "title": "높이",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "sunlight",
        "rule_id": "sunlight.building-act",
        "title": "정북 일조사선",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE",
          "NOT_COMPUTED_HERE"
        ]
      },
      {
        "key": "setback",
        "rule_id": "setback.road",
        "title": "이격(도로 경계)",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ],
        "edge_class": "road"
      },
      {
        "key": "setback",
        "rule_id": "setback.adjacent",
        "title": "이격(인접 대지 경계)",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ],
        "edge_class": "adjacent"
      },
      {
        "key": "parking",
        "rule_id": "parking.national",
        "title": "부설주차장 주차대수",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "seismic",
        "rule_id": "seismic.national",
        "title": "내진설계 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "zero_energy",
        "rule_id": "zero-energy.national",
        "title": "제로에너지건축물 설계 기준 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "supervision",
        "rule_id": "supervision.national",
        "title": "허가권자 지정감리 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      }
    ],
    "warnings": [
      {
        "code": "MUNICIPALITY_NOT_IN_PACK",
        "message": "조례 미확인 지자체(41135): 규칙 팩 지원 지역이 아니어서 합격·불합격을 표시하지 않습니다. 직접 확인하세요."
      }
    ]
  },
  {
    "projectId": "0192f0a0-1c00-7a01-8a01-000000000002",
    "massIds": [
      "m-mixed"
    ],
    "result": {
      "engine_version": "rules-0.1.0",
      "rule_pack_version": "2026.10.0",
      "application_date": "2026-11-15",
      "items": [
        {
          "key": "coverage",
          "verdict": "WARN",
          "unit": "pct",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 46.93
        },
        {
          "key": "far",
          "verdict": "WARN",
          "unit": "pct",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 140.8
        },
        {
          "key": "height",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 9800
        },
        {
          "key": "sunlight",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "건축법",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "setback",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 2000
        },
        {
          "key": "setback",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 2000
        },
        {
          "key": "parking",
          "verdict": "WARN",
          "unit": "count",
          "basis": [
            {
              "law": "주차장법 시행령",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "seismic",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "zero_energy",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "supervision",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        }
      ],
      "pending_changes": 0
    },
    "details": [
      {
        "key": "coverage",
        "rule_id": "coverage.national",
        "title": "건폐율",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "far",
        "rule_id": "far.national",
        "title": "용적률",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE",
          "FAR_EXCLUSIONS_UNVERIFIED"
        ]
      },
      {
        "key": "height",
        "rule_id": "height.national",
        "title": "높이",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "sunlight",
        "rule_id": "sunlight.building-act",
        "title": "정북 일조사선",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE",
          "NOT_COMPUTED_HERE"
        ]
      },
      {
        "key": "setback",
        "rule_id": "setback.road",
        "title": "이격(도로 경계)",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ],
        "edge_class": "road"
      },
      {
        "key": "setback",
        "rule_id": "setback.adjacent",
        "title": "이격(인접 대지 경계)",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ],
        "edge_class": "adjacent"
      },
      {
        "key": "parking",
        "rule_id": "parking.national",
        "title": "부설주차장 주차대수",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "seismic",
        "rule_id": "seismic.national",
        "title": "내진설계 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "zero_energy",
        "rule_id": "zero-energy.national",
        "title": "제로에너지건축물 설계 기준 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "supervision",
        "rule_id": "supervision.national",
        "title": "허가권자 지정감리 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      }
    ],
    "warnings": [
      {
        "code": "MUNICIPALITY_NOT_IN_PACK",
        "message": "조례 미확인 지자체(28185): 규칙 팩 지원 지역이 아니어서 합격·불합격을 표시하지 않습니다. 직접 확인하세요."
      }
    ]
  },
  {
    "projectId": "0192f0a0-1c00-7a01-8a01-000000000003",
    "massIds": [
      "m-multi"
    ],
    "result": {
      "engine_version": "rules-0.1.0",
      "rule_pack_version": "2026.10.0",
      "application_date": "2027-01-10",
      "items": [
        {
          "key": "coverage",
          "verdict": "WARN",
          "unit": "pct",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 35.33
        },
        {
          "key": "far",
          "verdict": "WARN",
          "unit": "pct",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 141.32
        },
        {
          "key": "height",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 11400
        },
        {
          "key": "sunlight",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "건축법",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "setback",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 3000
        },
        {
          "key": "setback",
          "verdict": "WARN",
          "unit": "mm",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ],
          "value": 2828
        },
        {
          "key": "parking",
          "verdict": "WARN",
          "unit": "count",
          "basis": [
            {
              "law": "주차장법 시행령",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "seismic",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "zero_energy",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        },
        {
          "key": "supervision",
          "verdict": "WARN",
          "unit": "bool",
          "basis": [
            {
              "law": "미확인",
              "article": "미확인",
              "effective_from": "미확인",
              "ordinance": false
            }
          ]
        }
      ],
      "pending_changes": 0
    },
    "details": [
      {
        "key": "coverage",
        "rule_id": "coverage.national",
        "title": "건폐율",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "far",
        "rule_id": "far.national",
        "title": "용적률",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE",
          "FAR_EXCLUSIONS_UNVERIFIED"
        ]
      },
      {
        "key": "height",
        "rule_id": "height.national",
        "title": "높이",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "sunlight",
        "rule_id": "sunlight.building-act",
        "title": "정북 일조사선",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE",
          "NOT_COMPUTED_HERE"
        ]
      },
      {
        "key": "setback",
        "rule_id": "setback.road",
        "title": "이격(도로 경계)",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ],
        "edge_class": "road"
      },
      {
        "key": "setback",
        "rule_id": "setback.adjacent",
        "title": "이격(인접 대지 경계)",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ],
        "edge_class": "adjacent"
      },
      {
        "key": "parking",
        "rule_id": "parking.national",
        "title": "부설주차장 주차대수",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "seismic",
        "rule_id": "seismic.national",
        "title": "내진설계 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "zero_energy",
        "rule_id": "zero-energy.national",
        "title": "제로에너지건축물 설계 기준 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      },
      {
        "key": "supervision",
        "rule_id": "supervision.national",
        "title": "허가권자 지정감리 대상",
        "status": "unverified",
        "reasons": [
          "UNVERIFIED_RULE"
        ]
      }
    ],
    "warnings": [
      {
        "code": "MUNICIPALITY_NOT_IN_PACK",
        "message": "조례 미확인 지자체(11680): 규칙 팩 지원 지역이 아니어서 합격·불합격을 표시하지 않습니다. 직접 확인하세요."
      }
    ]
  }
];
