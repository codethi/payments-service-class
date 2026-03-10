import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PaymentStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column('varchar')
  orderId: string;

  @Column('varchar')
  userId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'simple-enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 50 })
  paymentMethod: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transactionId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'datetime', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
