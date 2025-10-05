use anchor_lang::prelude::*;

declare_id!("5oB6pCT1QfSNykDaG41KiUHqW3AVVMjfk6QMhyXc7Sm");

#[program]
pub mod anchor_bencher {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
    pub fn test(ctx: Context<Test>) -> Result<()> {
        msg!("User key: {:?}", ctx.accounts.user.key());
        Ok(())
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
