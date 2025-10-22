const { filterStep } = require('./filter');

describe('filterStep', () => {
  const createTestResults = () => {
    return [
      {
        "campaign": {
          "id": 1,
          "name": "LSE-DA-RMKT"
        }
      },
      {
        "campaign": {
          "id": 1,
          "name": "LSE-DA-DISPLAY"
        }
      },
      {
        "campaign": {
          "id": 1,
          "name": "LSE-DM-SEARCH"
        }
      }
    ];
  }

  describe('exact match', () => {
    it('should filter rows using exact match when condition is matching', () => {
  
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "=", value: "LSE-DA-RMKT" }
        ]
      });
  
      expect(filtered).toEqual([
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DA-RMKT"
          }
        }
      ]);
    });

    it('should not filter rows using exact match when condition is not matching', () => {

      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "=", value: "LSE-DA-RMKTING" }
        ]
      });

      expect(filtered).toEqual([]);
    })
  });

  describe('contains', () => {
    it('should filter rows using contains when condition is matching', () => {
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "contains", value: "LSE-DA" }
        ]
      });

      expect(filtered).toEqual([
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DA-RMKT"
          }
        },
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DA-DISPLAY"
          }
        }
      ]);
    });

    it('should not filter rows using contains when condition is not matching', () => {
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "contains", value: "LSE-DA-RMKTY" }
        ]
      });

      expect(filtered).toEqual([]);
    });
    it('should filter rows using case insensitive contains when flag is set and condition is matching', () => {
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "contains", value: "lse-da-rmkt", flags: "i" }
        ]
      });

      expect(filtered).toEqual([
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DA-RMKT"
          }
        }
      ]);
    });

    it('should not filter rows using case insensitive contains when flag is set and condition is not matching', () => {
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "contains", value: "lse-da-rmkty", flags: "i" }
        ]
      });

      expect(filtered).toEqual([]);
    });
  });
  
  describe('and condition as default', () => {
    it('should return empty array when any of the conditions are not matching', () => {
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "contains", value: "LSE-DA" },
          { field: "campaign.name", op: "contains", value: "LSE-DM", flags: "i" }
        ]
      });

      expect(filtered).toEqual([]);
    });
    it('should filter rows using and condition when all conditions are matching', () => {
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "contains", value: "LSE-DA" },
          { field: "campaign.name", op: "contains", value: "RMKT", flags: "i" }
        ]
      });

      expect(filtered).toEqual([
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DA-RMKT"
          }
        }
      ]);
    });
  });


  describe('or condition', () => {
    it('should filter rows using or condition when any of the conditions are matching', () => {
      const filtered = filterStep(createTestResults(), {
        where: [
          { field: "campaign.name", op: "contains", value: "LSE-DA" },
          { field: "campaign.name", op: "contains", value: "LSE-DM", flags: "i" }
        ],
        logic: "OR"
      });

      expect(filtered).toEqual([
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DA-RMKT"
          }
        },
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DA-DISPLAY"
          }
        },
        {
          "campaign": {
            "id": 1,
            "name": "LSE-DM-SEARCH"
          }
        }
      ]);
    });
  });
  
});