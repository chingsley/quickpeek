import { Job } from 'bull';
import prisma from '../../../src/core/database/prisma/client';
import * as notifications from '../../../src/core/jobs/notifyNearbyUsersJob'; // Adjust the path as needed
import { calculateHaversineDistance } from '../../../src/common/utils/geo';
import seedTestData from '../../seed/notifyNearbyUsers.test.seed';
import clearSeed from '../../seed/clear.seed';

describe('Notification System', () => {
  beforeAll(async () => {
    try {
      await clearSeed(prisma);
      await seedTestData(prisma);
      console.log('Test data seeded successfully.');
    } catch (error) {
      console.error('Error seeding test data:', error);
      await prisma.$disconnect();
      process.exit(1);
    }

    // Optionally, run migrations and seed data here if not done manually
    // await import('../prisma/seed.test'); // If you prefer to seed within the test

    // .then(async () => {

    // })
    // .catch(async (e) => {

    // });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`BEGIN TRANSACTION`;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await prisma.$executeRaw`ROLLBACK TRANSACTION`;
    jest.clearAllMocks();
  });

  it('should notify approximately 10 nearby users for each question', async () => {
    const questions = await prisma.question.findMany();
    for (const question of questions) {
      const [longitude, latitude] = question.location.split(', ').map(Number);
      const radiusInKm = 10;

      const nearbyUsers = await notifications.findNearbyUsers(prisma, longitude, latitude, radiusInKm);
      expect(nearbyUsers.length).toBeGreaterThanOrEqual(1);
      for (const u of nearbyUsers) {
        const distance = calculateHaversineDistance(latitude, longitude, u.latitude, u.longitude);

        expect(distance.toFixed(2)).toEqual(u.distance.toFixed(2));
        expect(distance).toBeLessThanOrEqual(radiusInKm);
      }
    }
  });

  it.skip('should call the sendNotification function', async () => {
    const sendNotificationSpy = jest.spyOn(notifications, 'sendNotification').mockResolvedValue(Promise.resolve());
    const question = await prisma.question.findFirst();
    const [longitude, latitude] = question!.location.split(', ').map(Number);
    const radiusInKm = 10;
    await notifications.notifyNearbyUsers({
      data: {
        questionId: question!.id,
        questionTitle: question!.title,
        questionContent: question!.content,
        questionerId: question!.userId,
        questionLon: longitude,
        questionLat: latitude,
      }
    } as Job);

    const nearbyUsers = await notifications.findNearbyUsers(prisma, longitude, latitude, radiusInKm);

    expect(sendNotificationSpy).toHaveBeenCalledTimes(nearbyUsers.length);
    sendNotificationSpy.mockRestore();
  });

  it('should not notify users outside the 10 km radius', async () => {
    const farQuestion = await prisma.question.create({
      data: {
        userId: (await prisma.user.findFirst())!.id,
        title: '',
        content: 'Far away question',
        location: '180.0000, 90.0000', // Extreme coordinates unlikely to match any user
      },
    });

    const [longitude, latitude] = farQuestion.location.split(', ').map(Number);
    const radiusInKm = 10;
    const nearbyUsers = await notifications.findNearbyUsers(prisma, longitude, latitude, radiusInKm);
    expect(nearbyUsers.length).toBe(0);
  });
});
