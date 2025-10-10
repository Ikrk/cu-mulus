use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

declare_id!("5oB6pCT1QfSNykDaG41KiUHqW3AVVMjfk6QMhyXc7Sm");

#[program]
pub mod anchor_bencher {
    use anchor_lang::{solana_program::{instruction::Instruction, program::invoke}, InstructionData};

    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
    pub fn test(ctx: Context<Test>) -> Result<()> {
        msg!("User key: {:?}", ctx.accounts.user.key());
        Ok(())
    }
    pub fn test_with_cpi(ctx: Context<CreateUser>) -> Result<()> {
        ctx.accounts.user_account.name = "John".to_string();
        ctx.accounts.user_account.age = 30;
        let ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.user.key(), true),
            ],
            data: crate::instruction::TestNestedCpi{}.data()
        };

        invoke(&ix, &[ctx.accounts.user.to_account_info()])?;

        let ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.user.key(), true),
            ],
            data: crate::instruction::TestCpi2{}.data()
        };

        invoke(&ix, &[ctx.accounts.user.to_account_info()])?;
        Ok(())
    }
    pub fn test_nested_cpi(ctx: Context<Test>) -> Result<()> {
        msg!("Test CPI 1");
        let ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.user.key(), true),
            ],
            data: crate::instruction::TestCpi2{}.data()
        };

        invoke(&ix, &[ctx.accounts.user.to_account_info()])?;
        Ok(())
    }
    pub fn test_cpi_2(_ctx: Context<Test>) -> Result<()> {
        msg!("Test CPI 2");
        Ok(())
    }
    pub fn test_with_error(_ctx: Context<CreateUser>) -> Result<()> {
        err!(MyError::SomeError)
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct Test<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub user: Signer<'info>,
    // pub user: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CreateUser<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + User::INIT_SPACE
    )]
    pub user_account: Account<'info, User>,

    #[account(
        init,
        payer = user,
        mint::decimals = 9,
        mint::authority = user,
        mint::freeze_authority = user
    )]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Default, InitSpace)]
pub struct User {
    #[max_len(100)]
    pub name: String,
    pub age: u8,
}

#[error_code]
pub enum MyError {
    SomeError,
}
