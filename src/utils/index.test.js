const { getAtPath, setAtPath } = require('./index');
describe('utils', () => {
  const createTestResults = () => {
    return {
      a: {
        b: {
          c: 1
        }
      }
    }
  };

  describe('getAtPath', () => {

    it('should return the value at the given path', () => {
      const obj = createTestResults();
      expect(getAtPath(obj, 'a.b.c')).toBe(1);
    });
    it('should return undefined if the path does not exist', () => {
      const obj = createTestResults();
      expect(getAtPath(obj, 'a.b.d')).toBeUndefined();
    });
  });
  
  describe('setAtPath', () => {
    it('should set the value at the given path', () => {
      const obj = createTestResults();
      setAtPath(obj, 'a.b.c', 2);
      expect(obj.a.b.c).toBe(2);
    });
    it('should create the path if it does not exist', () => {
      const obj = createTestResults();
      setAtPath(obj, 'a.b.d', 3);
      expect(obj.a.b.d).toBe(3);
    });
  });
});