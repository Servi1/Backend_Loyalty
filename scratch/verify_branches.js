const branchesService = require('../src/app/branches/branches.service');
const assert = require('assert');

// We'll mock the db and other things to verify our helpers can run
console.log('Verifying branches.service.js modifications...');

// Test 1: Let's create mock branch objects and inspect checkIsOpen and formatBranchHours outputs.
// Since these functions aren't exported directly, we can test by calling `getBranches` or `getBranch` with a mock DB object.

const mockDb = {
  branch: {
    findMany: async () => {
      return [
        {
          id: 'branch-1',
          name: 'Branch 1',
          isOpen: true,
          openingTime: '08:00 AM',
          closingTime: '11:00 PM',
          timezone: 'Asia/Riyadh',
        },
        {
          id: 'branch-2',
          name: 'Branch 2',
          isOpen: false, // Override closed
          openingTime: '08:00 AM',
          closingTime: '11:00 PM',
          timezone: 'Asia/Riyadh',
        },
        {
          id: 'branch-3',
          name: 'Branch 3',
          isOpen: true,
          openingTime: null,
          closingTime: null,
          hours: '9am - 9pm',
        }
      ];
    },
    findUnique: async () => {
      return {
        id: 'branch-1',
        name: 'Branch 1',
        isOpen: true,
        openingTime: '08:00 AM',
        closingTime: '11:00 PM',
        timezone: 'Asia/Riyadh',
      };
    }
  }
};

(async () => {
  try {
    const branches = await branchesService.getBranches(mockDb);
    console.log('getBranches output:', JSON.stringify(branches, null, 2));

    assert.strictEqual(branches[0].hours, '08:00 AM - 11:00 PM');
    assert.strictEqual(branches[1].isOpen, false); // manual override closed
    assert.strictEqual(branches[2].hours, '9am - 9pm'); // fallback to hours
    assert.strictEqual(branches[2].isOpen, true); // fallback default open

    const singleBranch = await branchesService.getBranch(mockDb, 'branch-1');
    console.log('getBranch output:', JSON.stringify(singleBranch, null, 2));
    assert.strictEqual(singleBranch.hours, '08:00 AM - 11:00 PM');

    // Test 3: Test getBranchScheduleSlots with openingTime/closingTime (e.g. 08:00 AM - 11:00 PM)
    const mockDbForSlots = {
      branch: {
        findUnique: async () => {
          return {
            openingTime: '08:30 AM',
            closingTime: '10:30 AM',
            hours: '9am - 9pm'
          };
        }
      },
      order: {
        findMany: async () => []
      }
    };
    const slotsRes = await branchesService.getBranchScheduleSlots(mockDbForSlots, 'branch-1', '2026-08-27', 30);
    console.log('getBranchScheduleSlots output (08:30 AM - 10:30 AM, 30 min duration):', JSON.stringify(slotsRes, null, 2));
    assert.deepStrictEqual(slotsRes.slots.map(s => s.time), [
      '08:30',
      '09:00',
      '09:30',
      '10:00'
    ]);

    // Test 4: Test fallback to hours parsing in getBranchScheduleSlots (e.g. 9am - 12pm)
    const mockDbFallbackHours = {
      branch: {
        findUnique: async () => {
          return {
            openingTime: null,
            closingTime: null,
            hours: '09:00 am - 12:00 pm'
          };
        }
      },
      order: {
        findMany: async () => []
      }
    };
    const slotsResFallback = await branchesService.getBranchScheduleSlots(mockDbFallbackHours, 'branch-1', '2026-08-27', 60);
    console.log('getBranchScheduleSlots output (fallback 9am - 12pm, 60 min duration):', JSON.stringify(slotsResFallback, null, 2));
    assert.deepStrictEqual(slotsResFallback.slots.map(s => s.time), [
      '09:00',
      '10:00',
      '11:00'
    ]);

    console.log('All tests passed successfully!');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
