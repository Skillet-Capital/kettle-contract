// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ERC721Holder } from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import { LoanOffer, BorrowOffer, Lien, MarketOffer, Side } from "./Structs.sol";
import { InvalidLien, LienDefaulted, LienIsCurrent, MakerIsNotBorrower, InsufficientAskAmount, OnlyBorrower, OfferNotAsk, OfferNotBid, BidNotWithLoan, BidCannotBorrow, BidRequiresLoan, InvalidMarketOfferAmount } from "./Errors.sol";

import { IKettle } from "./interfaces/IKettle.sol";
import { OfferController } from "./OfferController.sol";
import { CollateralVerifier } from "./CollateralVerifier.sol";
import { OfferMatcher } from "./OfferMatcher.sol";
import { Transfer } from "./Transfer.sol";

import { CompoundInterest } from "./models/CompoundInterest.sol";
import { Distributions } from "./lib/Distributions.sol";

import { ILenderReceipt } from "./LenderReceipt.sol";

/**
 * @title Kettle Lending and Marketplace Contract
 * @author diamondjim.eth
 * @notice Provides lending and marketplace functionality for ERC721 and ERC1155
 */
contract Kettle is IKettle, Transfer, OfferController, CollateralVerifier, OfferMatcher, ERC721Holder, ERC1155Holder {
    ILenderReceipt public immutable LENDER_RECEIPT;

    uint256 private _nextLienId;
    mapping(uint256 => bytes32) public liens;

    constructor(address _lenderReceiptAddress) public OfferController() {
        LENDER_RECEIPT = ILenderReceipt(_lenderReceiptAddress);
    }

    function getLender(uint256 lienId) public returns (address) {
        return LENDER_RECEIPT.ownerOf(lienId);
    }

    function currentDebtAmount(Lien memory lien) public view returns (uint256 debt, uint256 fee, uint256 interest) {
        return CompoundInterest.currentDebtAmount(
            block.timestamp,
            lien.principal, 
            lien.startTime,
            lien.duration, 
            lien.fee, 
            lien.rate, 
            lien.defaultRate
        );
    }

    function currentDebtAmountExact(
        uint256 timestamp, 
        uint256 principal, 
        uint256 startTime,
        uint256 duration,
        uint256 fee,
        uint256 rate,
        uint256 defaultRate
    ) public view returns (uint256 debt, uint256 feeInterest, uint256 lenderInterest) {
        return CompoundInterest.currentDebtAmount(
            timestamp,
            principal, 
            startTime,
            duration, 
            fee, 
            rate, 
            defaultRate
        );
    }

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/
    
    /**
     * @notice Allows a borrower to borrow funds and use a specified asset as collateral.
     * @param offer The details of the loan offer, including collateral, terms, etc.
     * @param amount The amount of funds to borrow.
     * @param tokenId The identifier of the asset used as collateral.
     * @param borrower The address of the borrower. If set to address(0), the sender's address is used.
     * @param signature The signature provided by the borrower to verify the loan agreement.
     * @param proof An array of proof elements to verify the collateral ownership.
     * @return lienId The identifier of the lien created for the borrowed funds.
     */
    function borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower,
        bytes calldata signature,
        bytes32[] calldata proof
    ) public returns (uint256 lienId){
        if (borrower == address(0)) borrower = msg.sender;

        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, tokenId, proof);

        lienId = _borrow(offer, amount, tokenId, borrower, signature);

        transferToken(offer.collateral.itemType, offer.collateral.collection, msg.sender, address(this), tokenId, offer.collateral.size);
        transferCurrency(offer.terms.currency, offer.lender, borrower, amount);
    }

    /**
     * @notice Internal function to handle the borrowing process and create a lien for the borrowed funds.
     * @param offer The details of the loan offer, including collateral, terms, etc.
     * @param amount The amount of funds to borrow.
     * @param tokenId The identifier of the asset used as collateral.
     * @param borrower The address of the borrower.
     * @param signature The signature provided by the borrower to verify the loan agreement.
     * @return lienId The identifier of the newly created lien for the borrowed funds.
     */
    function _borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower,
        bytes calldata signature
    ) internal returns (uint256 lienId) {

        Lien memory lien = Lien(
            offer.fee.recipient,
            borrower,
            offer.terms.currency,
            offer.collateral.collection,
            offer.collateral.itemType,
            tokenId,
            offer.collateral.size,
            amount,
            offer.fee.rate,
            offer.terms.rate,
            offer.terms.defaultRate,
            offer.terms.duration,
            offer.terms.gracePeriod,
            block.timestamp
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        _takeLoanOffer(lienId, offer, lien, signature);

        // mint lender receipt
        LENDER_RECEIPT.mint(offer.lender, lienId);

        emit Borrow(
            lienId,
            offer.lender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            uint8(lien.itemType),
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.fee,
            lien.rate,
            lien.defaultRate,
            lien.duration,
            lien.gracePeriod,
            lien.startTime
        );
    }

    /**
     * @notice Allows a lender to provide a loan based on a specified borrow offer.
     * @param offer The details of the borrow offer, including collateral, terms, etc.
     * @param signature The signature provided by the lender to verify the loan agreement.
     * @return lienId The identifier of the newly created lien for the loaned funds.
     */
    function loan(
        BorrowOffer calldata offer,
        bytes calldata signature
    ) public returns (uint256 lienId) {
        lienId = _loan(offer, signature);

        transferToken(offer.collateral.itemType, offer.collateral.collection, offer.borrower, address(this), offer.collateral.identifier, offer.collateral.size);
        transferCurrency(offer.terms.currency, msg.sender, offer.borrower, offer.terms.amount);
    }
    /**
     * @dev Internal function to handle the loan process and create a lien for the loaned funds.
     * @param offer The details of the borrow offer, including collateral, terms, etc.
     * @param signature The signature provided by the lender to verify the loan agreement.
     * @return lienId The identifier of the newly created lien for the loaned funds.
     */
    function _loan(
        BorrowOffer calldata offer,
        bytes calldata signature
    ) internal returns (uint256 lienId) {

        Lien memory lien = Lien(
            offer.fee.recipient,
            offer.borrower,
            offer.terms.currency,
            offer.collateral.collection,
            offer.collateral.itemType,
            offer.collateral.identifier,
            offer.collateral.size,
            offer.terms.amount,
            offer.fee.rate,
            offer.terms.rate,
            offer.terms.defaultRate,
            offer.terms.duration,
            offer.terms.gracePeriod,
            block.timestamp
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        _takeBorrowOffer(lienId, offer, signature);

        // mint lender receipt
        LENDER_RECEIPT.mint(msg.sender, lienId);

        emit Borrow(
            lienId,
            msg.sender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            uint8(lien.itemType),
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.fee,
            lien.rate,
            lien.defaultRate,
            lien.duration,
            lien.gracePeriod,
            lien.startTime
        );
    }

    /*//////////////////////////////////////////////////
                    REFINANCE FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Allows the borrower to refinance an existing loan with a new loan offer.
     * @param oldLienId The identifier of the existing lien being refinanced.
     * @param amount The amount of funds to borrow through the refinance.
     * @param lien The details of the existing loan (calldata).
     * @param offer The details of the new loan offer, including collateral, terms, etc.
     * @param signature The signature provided by the borrower to verify the new loan agreement.
     * @param proof An array of proof elements to verify the collateral ownership.
     * @return newLienId The identifier of the newly created lien for the refinanced funds.
     */
    function refinance(
        uint256 oldLienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata offer,
        bytes calldata signature,
        bytes32[] calldata proof
    ) public validateLien(lien, oldLienId) lienIsCurrent(lien) onlyBorrower(lien )returns (uint256 newLienId) {
        
        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, lien.tokenId, proof);
        _matchLoanOfferWithLien(offer, lien);
        
        // borrow funds through the refinance and get the new lien identifier
        newLienId = _borrow(offer, amount, lien.tokenId, msg.sender, signature);

        // get payment details of the existing lien
        (uint256 debt, uint256 fee, uint256 interest) = currentDebtAmount(lien);
        
        // distribute loan payments from new lender to old lender and pay or transfer net funds from borrower
        Distributions.distributeLoanPayments(
            lien.currency,
            amount,                 // distribute new principal
            debt,
            lien.principal + interest,
            fee,
            getLender(oldLienId),   // original lender
            lien.recipient,         // original recipient
            offer.lender,           // primary payer
            msg.sender,             // pays any remaining amount
            msg.sender              // receives net principal
        );

        // burn the lender receipt for the old lien
        LENDER_RECEIPT.burn(oldLienId);
        delete liens[oldLienId];

        emit Refinance(
            oldLienId,
            newLienId,
            amount,
            debt,
            lien.principal,
            interest,
            fee
        );
    }

    /**
     * @notice Allows another lender to refinance an existing loan with a new borrow offer.
     * @param oldLienId The identifier of the existing lien being refinanced.
     * @param lien The details of the existing loan (calldata).
     * @param offer The details of the borrow offer, including collateral, terms, etc.
     * @param signature The signature provided by the borrower to verify the new loan agreement.
     * @param proof An array of proof elements to verify the collateral ownership.
     * @return newLienId The identifier of the newly created lien for the refinanced funds.
     */
    function refinanceWithBorrowOffer(
        uint256 oldLienId,
        Lien calldata lien,
        BorrowOffer calldata offer,
        bytes calldata signature,
        bytes32[] calldata proof
    ) public validateLien(lien, oldLienId) lienIsCurrent(lien) returns (uint256 newLienId) {
        if (offer.borrower != lien.borrower) revert MakerIsNotBorrower();
        
        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, lien.tokenId, proof);
        _matchBorrowOfferWithLien(offer, lien);

        // borrow funds through the refinance and get the new lien identifier
        newLienId = _loan(offer, signature);

        // get payment details of the existing lien
        (uint256 debt, uint256 fee, uint256 interest) = currentDebtAmount(lien);
        
        // distribute loan payments from new lender to old lender and pay or transfer net funds from borrower
        Distributions.distributeLoanPayments(
            lien.currency,
            offer.terms.amount,           // distribute new principal
            debt,
            lien.principal + interest,
            fee,
            getLender(oldLienId),   // original lender
            lien.recipient,         // original recipient
            msg.sender,             // primary payer
            lien.borrower,          // pays any remaining amount
            lien.borrower           // receives net principal
        );

        // burn the lender receipt for the old lien
        LENDER_RECEIPT.burn(oldLienId);
        delete liens[oldLienId];

        emit Refinance(
            oldLienId,
            newLienId,
            offer.terms.amount,
            debt,
            lien.principal,
            interest,
            fee
        );
    }

    /*//////////////////////////////////////////////////
                    REPAY FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Allows the borrower to repay loan
     * @param lienId The identifier of the lien representing the loan.
     * @param lien The details of the loan (calldata).
     */
    function repay(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (uint256 debt, uint256 fee, uint256 interest) = currentDebtAmount(lien);

        transferToken(lien.itemType, lien.collection, address(this), lien.borrower, lien.tokenId, lien.size);
        transferCurrency(lien.currency, msg.sender, getLender(lienId), lien.principal + interest);
        transferCurrency(lien.currency, msg.sender, lien.recipient, fee);

        // burn the lender receipt for the lien
        LENDER_RECEIPT.burn(lienId);
        delete liens[lienId];

        emit Repay(
            lienId,
            debt,
            lien.principal,
            interest,
            fee
        );
    }

    /*//////////////////////////////////////////////////
                    DEFAULT FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Allows the lender to claim the collateral when a lien has defaulted.
     * @param lienId The identifier of the lien representing the loan.
     * @param lien The details of the loan (calldata).
     */
    function claim(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) {
        // check if the lien is defaulted; if not, revert
        if (!_lienIsDefaulted(lien)) {
            revert LienIsCurrent();
        }

        address lender = getLender(lienId);
        transferToken(lien.itemType, lien.collection, address(this), lender, lien.tokenId, lien.size);

        // burn lender receipt
        LENDER_RECEIPT.burn(lienId);
        delete liens[lienId];

        emit Claim(lienId, lender);
    }

    /*//////////////////////////////////////////////////
                    MARKETPLACE FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Allows users to execute a market order, either as a bidder (BID) or as an asker (ASK).
     * @param tokenId The identifier of the asset involved in the market order.
     * @param offer The details of the market offer, including collateral, terms, etc.
     * @param signature The signature provided by the maker to verify the market offer.
     * @param proof An array of proof elements to verify the collateral ownership.
     * @return netAmount The net amount transferred after considering market fees.
     */
     function marketOrder(
        uint256 tokenId,
        MarketOffer calldata offer,
        bytes calldata signature,
        bytes32[] calldata proof
     ) public returns (uint256 netAmount) {

        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, tokenId, proof);
        _takeMarketOffer(offer, tokenId, signature);
        
        if (offer.side == Side.BID) {
            if (offer.terms.withLoan) revert BidRequiresLoan();

            // pay market fees (bidder pays fees)
            netAmount = _payMarketFees(offer.terms.currency, offer.maker, offer.fee.recipient, offer.terms.amount, offer.fee.rate);

            transferToken(offer.collateral.itemType, offer.collateral.collection, msg.sender, offer.maker, tokenId, offer.collateral.size);
            transferCurrency(offer.terms.currency, offer.maker, msg.sender, netAmount);

        } else {
            // pay market fees (buyer pays fees)
            netAmount = _payMarketFees(offer.terms.currency, msg.sender, offer.fee.recipient, offer.terms.amount, offer.fee.rate);

            transferToken(offer.collateral.itemType, offer.collateral.collection, offer.maker, msg.sender, tokenId, offer.collateral.size);
            transferCurrency(offer.terms.currency, msg.sender, offer.maker, netAmount);
        }

        emit MarketOrder(
            offer.side == Side.BID ? offer.maker : msg.sender,
            offer.side == Side.BID ? msg.sender : offer.maker,
            offer.terms.currency,
            offer.collateral.collection,
            tokenId,
            offer.collateral.size,
            offer.terms.amount,
            netAmount
        );
    }

    /**
     * @notice Allows a buyer to purchase an asset with a loan, using a loan offer and a corresponding market ask offer.
     * @param tokenId The identifier of the asset involved in the transaction.
     * @param amount The amount of the loan requested by the buyer.
     * @param loanOffer The details of the loan offer, including collateral, terms, etc.
     * @param askOffer The details of the market ask offer, including collateral, terms, etc.
     * @param loanOfferSignature The signature provided by the borrower to verify the loan offer.
     * @param askOfferSignature The signature provided by the maker to verify the market ask offer.
     * @param loanProof An array of proof elements to verify the collateral ownership for the loan offer.
     * @param askProof An array of proof elements to verify the collateral ownership for the ask offer.
     * @return lienId The identifier of the newly created lien representing the loan.
     */
    function buyWithLoan(
        uint256 tokenId,
        uint256 amount,
        LoanOffer calldata loanOffer,
        MarketOffer calldata askOffer,
        bytes calldata loanOfferSignature,
        bytes calldata askOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata askProof
    ) public returns (uint256 lienId) {
        if (askOffer.side != Side.ASK) revert OfferNotAsk();

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, tokenId, loanProof);
        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, tokenId, askProof);

        _matchMarketOfferWithLoanOffer(askOffer, loanOffer);
        _takeMarketOffer(askOffer, tokenId, askOfferSignature);

        // start a lien (borrow min of requested amount and ask offer amount)
        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);
        lienId = _borrow(loanOffer, _borrowAmount, tokenId, msg.sender, loanOfferSignature);

        // transfer loan principal from lender and rest of amount from buyer to seller
        transferCurrency(loanOffer.terms.currency, loanOffer.lender, askOffer.maker, _borrowAmount);
        transferCurrency(askOffer.terms.currency, msg.sender, askOffer.maker, askOffer.terms.amount - _borrowAmount);

        // retrieve fees from seller
        uint256 netAmount = _payMarketFees(askOffer.terms.currency, askOffer.maker, askOffer.fee.recipient, askOffer.terms.amount, askOffer.fee.rate);

        // lock collateral
        transferToken(loanOffer.collateral.itemType, loanOffer.collateral.collection, askOffer.maker, address(this), tokenId, loanOffer.collateral.size);

        emit BuyWithLoan(
            lienId,
            msg.sender,
            askOffer.maker,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            tokenId,
            askOffer.collateral.size,
            askOffer.terms.amount,
            netAmount,
            _borrowAmount
        );
    }

    /**
     * @notice Allows a seller to initiate a loan through a loan offer and sell an asset with a corresponding market bid offer.
     * @param tokenId The identifier of the asset involved in the transaction.
     * @param loanOffer The details of the loan offer, including collateral, terms, etc.
     * @param bidOffer The details of the market bid offer, including collateral, terms, etc.
     * @param loanOfferSignature The signature provided by the borrower to verify the loan offer.
     * @param bidOfferSignature The signature provided by the bidder to verify the market bid offer.
     * @param loanProof An array of proof elements to verify the collateral ownership for the loan offer.
     * @param bidProof An array of proof elements to verify the collateral ownership for the bid offer.
     * @return lienId The identifier of the newly created lien representing the loan.
     */
    function sellWithLoan(
        uint256 tokenId,
        LoanOffer calldata loanOffer,
        MarketOffer calldata bidOffer,
        bytes calldata loanOfferSignature,
        bytes calldata bidOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata bidProof
    ) public returns (uint256 lienId) {
        if (bidOffer.side != Side.BID) revert OfferNotBid();
        if (!bidOffer.terms.withLoan) revert BidNotWithLoan();

        // verify the loan offer hash matches the bid offer's expected loan offer hash
        bytes32 _loanOfferHash = _hashLoanOffer(loanOffer);
        if (!(bidOffer.terms.loanOfferHash == _loanOfferHash)) {
            revert BidCannotBorrow();
        }

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, tokenId, loanProof);
        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, tokenId, bidProof);

        _matchMarketOfferWithLoanOffer(bidOffer, loanOffer);
        _takeMarketOffer(bidOffer, tokenId, bidOfferSignature);

        // start loan (borrow amount specified in bid)
        lienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, tokenId, bidOffer.maker, loanOfferSignature);

        // transfer loan principal from lender and rest of amount from bidder to seller
        transferCurrency(loanOffer.terms.currency, loanOffer.lender, msg.sender, bidOffer.terms.borrowAmount);
        transferCurrency(bidOffer.terms.currency, bidOffer.maker, msg.sender, bidOffer.terms.amount - bidOffer.terms.borrowAmount);

        // retrieve fees from seller
        uint256 netAmount = _payMarketFees(bidOffer.terms.currency, msg.sender, bidOffer.fee.recipient, bidOffer.terms.amount, bidOffer.fee.rate);

        // lock collateral
        transferToken(loanOffer.collateral.itemType, loanOffer.collateral.collection, msg.sender, address(this), tokenId, loanOffer.collateral.size);

        emit SellWithLoan(
            lienId,
            bidOffer.maker,
            msg.sender,
            bidOffer.terms.currency,
            bidOffer.collateral.collection,
            tokenId,
            bidOffer.collateral.size,
            bidOffer.terms.amount,
            netAmount,
            bidOffer.terms.borrowAmount
        );
    }

    /**
     * @notice Allows a buyer to purchase an asset within an existing lien using a market ask offer.
     * @param lienId The identifier of the lien representing the loan.
     * @param lien The details of the lien, including borrower, lender, terms, etc.
     * @param askOffer The details of the market ask offer, including collateral, terms, etc.
     * @param askOfferSignature The signature provided by the maker to verify the market ask offer.
     * @param proof An array of proof elements to verify the collateral ownership for the market ask offer.
     */
    function buyInLien(
        uint256 lienId,
        Lien calldata lien,
        MarketOffer calldata askOffer,
        bytes calldata askOfferSignature,
        bytes32[] calldata proof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        if (lien.borrower != askOffer.maker) revert MakerIsNotBorrower();
        if (askOffer.side != Side.ASK) revert OfferNotAsk();

        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, lien.tokenId, proof);
        _matchMarketOfferWithLien(askOffer, lien);
        _takeMarketOffer(askOffer, lien.tokenId, askOfferSignature);

        // pay market fees (buyer pays fees)
        uint256 netAmount = _payMarketFees(askOffer.terms.currency, msg.sender, askOffer.fee.recipient, askOffer.terms.amount, askOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 debt, uint256 fee, uint256 interest) = currentDebtAmount(lien);

        // net ask amount must be greater than amount owed
        if (netAmount < debt) {
            revert InsufficientAskAmount();
        }

        Distributions.distributeLoanPayments(
            lien.currency, 
            netAmount,                  // distribute net ask amount
            debt, 
            lien.principal + interest,
            fee,
            getLender(lienId), 
            lien.recipient, 
            msg.sender,                 // buyer pays primary amount
            msg.sender,                 // buyer pays residual amount
            askOffer.maker              // seller receives net principal
        );

        // transfer collateral from this to buyer
        transferToken(lien.itemType, lien.collection, address(this), msg.sender, lien.tokenId, lien.size);

        // burn the lender receipt for the lien
        LENDER_RECEIPT.burn(lienId);
        delete liens[lienId];

        emit BuyInLien(
            lienId,
            msg.sender,
            lien.borrower,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            lien.tokenId,
            lien.size,
            askOffer.terms.amount,
            netAmount,
            debt,
            lien.principal,
            interest,
            fee
        );
    }

    /**
     * @notice Allows a borrower to sell an asset within an existing lien using a market bid offer.
     * @param lienId The identifier of the lien representing the loan.
     * @param lien The details of the lien, including borrower, lender, terms, etc.
     * @param bidOffer The details of the market bid offer, including collateral, terms, etc.
     * @param bidOfferSignature The signature provided by the bidder to verify the market bid offer.
     * @param proof An array of proof elements to verify the collateral ownership for the market bid offer.
     */
    function sellInLien(
        uint256 lienId,
        Lien calldata lien,
        MarketOffer calldata bidOffer,
        bytes calldata bidOfferSignature,
        bytes32[] calldata proof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) onlyBorrower(lien) {
        if (bidOffer.side != Side.BID) revert OfferNotBid();
        if (bidOffer.terms.withLoan) revert BidRequiresLoan();

        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, lien.tokenId, proof);
        _matchMarketOfferWithLien(bidOffer, lien);
        _takeMarketOffer(bidOffer, lien.tokenId, bidOfferSignature);

        // pay market fees (bidder pays fees)
        uint256 netAmount = _payMarketFees(bidOffer.terms.currency, bidOffer.maker, bidOffer.fee.recipient, bidOffer.terms.amount, bidOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 debt, uint256 fee, uint256 interest) = currentDebtAmount(lien);
        
        Distributions.distributeLoanPayments(
            lien.currency,
            netAmount,                      // distribute net bid amount
            debt,
            lien.principal + interest,
            fee,
            getLender(lienId),
            lien.recipient,
            bidOffer.maker,                 // bidder pays primary amount
            msg.sender,                     // seller pays residual amount
            msg.sender                      // seller receives net principal
        );
        
        // transfer collateral from this to buyer
        transferToken(lien.itemType, lien.collection, address(this), bidOffer.maker, lien.tokenId, lien.size);

        // burn the lender receipt for the lien
        LENDER_RECEIPT.burn(lienId);
        delete liens[lienId];

        emit SellInLien(
            lienId, 
            bidOffer.maker, 
            lien.borrower, 
            lien.currency, 
            lien.collection, 
            lien.tokenId, 
            lien.size, 
            bidOffer.terms.amount, 
            netAmount,
            debt, 
            lien.principal, 
            interest, 
            fee
        );
    }

    /**
     * @notice Allows a buyer to purchase an asset within an existing lien using a market ask offer and a new loan offer.
     * @param lienId The identifier of the existing lien representing the loan.
     * @param amount The amount to borrow in the new loan offer.
     * @param lien The details of the existing lien, including borrower, lender, terms, etc.
     * @param loanOffer The details of the new loan offer, including collateral, terms, etc.
     * @param askOffer The details of the market ask offer, including collateral, terms, etc.
     * @param loanOfferSignature The signature provided by the borrower to verify the new loan offer.
     * @param askOfferSignature The signature provided by the maker to verify the market ask offer.
     * @param loanProof An array of proof elements to verify the collateral ownership for the new loan offer.
     * @param askProof An array of proof elements to verify the collateral ownership for the market ask offer.
     * @return newLienId The identifier of the new lien representing the new loan.
     */
    function buyInLienWithLoan(
        uint256 lienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata loanOffer,
        MarketOffer calldata askOffer,
        bytes calldata loanOfferSignature,
        bytes calldata askOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata askProof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) returns (uint256 newLienId) {
        if (askOffer.maker != lien.borrower) revert MakerIsNotBorrower();
        if (askOffer.side != Side.ASK) revert OfferNotAsk();

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, lien.tokenId, loanProof);
        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, lien.tokenId, askProof);

        _matchMarketOfferWithLien(askOffer, lien);
        _matchLoanOfferWithLien(loanOffer, lien);

        _takeMarketOffer(askOffer, lien.tokenId, askOfferSignature);

        // start new loan
        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);
        newLienId = _borrow(loanOffer, _borrowAmount, lien.tokenId, msg.sender, loanOfferSignature);

        // transfer loan principal from lender and rest of amount from buyer to the contract
        transferCurrency(lien.currency, loanOffer.lender, address(this), _borrowAmount);
        transferCurrency(lien.currency, msg.sender, address(this), askOffer.terms.amount - _borrowAmount);

        // pay market fees (from this contract)
        uint256 netAmount = _payMarketFees(lien.currency, address(this), askOffer.fee.recipient, askOffer.terms.amount, askOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 debt, uint256 fee, uint256 interest) = currentDebtAmount(lien);

        // net amount payable to lien must be greater than balance
        if (netAmount < debt) {
            revert InsufficientAskAmount();
        }

        // transfer net principal to seller and pay balance and fees
        uint256 netPrincipal = netAmount - debt;
        transferCurrency(lien.currency, address(this), askOffer.maker, netPrincipal);
        transferCurrency(lien.currency, address(this), getLender(lienId), lien.principal + interest);
        transferCurrency(lien.currency, address(this), lien.recipient, fee);

        // burn the lender receipt
        LENDER_RECEIPT.burn(lienId);
        delete liens[lienId];

        emit BuyInLienWithLoan(
            lienId,
            newLienId,
            msg.sender,
            lien.borrower,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            lien.tokenId,
            lien.size,
            askOffer.terms.amount,
            netAmount,
            _borrowAmount,
            debt,
            lien.principal,
            interest,
            fee
        );
    }

    /**
     * @notice Allows a borrower to sell an asset within an existing lien using a market bid offer and a new loan offer.
     * @param lienId The identifier of the existing lien representing the loan.
     * @param lien The details of the existing lien, including borrower, lender, terms, etc.
     * @param loanOffer The details of the new loan offer, including collateral, terms, etc.
     * @param bidOffer The details of the market bid offer, including collateral, terms, etc.
     * @param loanOfferSignature The signature provided by the borrower to verify the new loan offer.
     * @param bidOfferSignature The signature provided by the maker to verify the market bid offer.
     * @param loanProof An array of proof elements to verify the collateral ownership for the new loan offer.
     * @param bidProof An array of proof elements to verify the collateral ownership for the market bid offer.
     * @return newLienId The identifier of the new lien representing the new loan.
     */
    function sellInLienWithLoan(
        uint256 lienId,
        Lien calldata lien,
        LoanOffer calldata loanOffer,
        MarketOffer calldata bidOffer,
        bytes calldata loanOfferSignature,
        bytes calldata bidOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata bidProof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) onlyBorrower(lien) returns (uint256 newLienId) {
        if (bidOffer.side != Side.BID) {
            revert OfferNotBid();
        }

        if (!bidOffer.terms.withLoan) {
            revert BidNotWithLoan();
        }

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, lien.tokenId, loanProof);
        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, lien.tokenId, bidProof);

        _matchMarketOfferWithLien(bidOffer, lien);
        _matchLoanOfferWithLien(loanOffer, lien);

        _takeMarketOffer(bidOffer, lien.tokenId, bidOfferSignature);

        // borrow from loan offer
        newLienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, lien.tokenId, bidOffer.maker, loanOfferSignature);

        // transfer loan principal and rest of bid to this
        transferCurrency(lien.currency, loanOffer.lender, address(this), bidOffer.terms.borrowAmount);
        transferCurrency(lien.currency, bidOffer.maker, address(this), bidOffer.terms.amount - bidOffer.terms.borrowAmount);

        // pay market fees (from this contract)
        uint256 netAmount = _payMarketFees(bidOffer.terms.currency, address(this), bidOffer.fee.recipient, bidOffer.terms.amount, bidOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 debt, uint256 fee, uint256 interest) = currentDebtAmount(lien);

        Distributions.distributeLoanPayments(
            lien.currency,
            netAmount,                  // distribute net amount bid amount
            debt,
            lien.principal + interest,
            fee,
            getLender(lienId),
            lien.recipient,
            address(this),              // this is the primary payer
            msg.sender,                 // seller pays residual amount
            msg.sender                  // seller receives net principal
        );

        // burn the lender receipt
        LENDER_RECEIPT.burn(lienId);
        delete liens[lienId];

        emit SellInLienWithLoan(
            lienId, 
            newLienId, 
            bidOffer.maker, 
            lien.borrower, 
            lien.currency, 
            lien.collection, 
            lien.tokenId, 
            lien.size, 
            bidOffer.terms.amount,
            netAmount,
            bidOffer.terms.borrowAmount, 
            debt,
            lien.principal, 
            interest,
            fee
        );
    }

    /**
     * @dev Calculates and transfers market fees.
     * @param currency The address of the currency used for the transaction.
     * @param payer The address of the payer who will cover the fees.
     * @param recipient The address of the recipient who will receive the fees.
     * @param amount The total amount involved in the transaction.
     * @param fee The fee rate (in basis points) to be applied to the amount.
     * @return netAmount The net amount after deducting the fees.
     */
    function _payMarketFees(
        address currency,
        address payer,
        address recipient,
        uint256 amount,
        uint256 fee
    ) internal returns (uint256 netAmount) {
        uint256 feeAmount = amount * fee / 10_000;
        if (feeAmount > amount) {
            revert InvalidMarketOfferAmount();
        }

        transferCurrency(currency, payer, recipient, feeAmount);
        netAmount = amount - feeAmount;
    }

    /*//////////////////////////////////////////////////
                        MODIFIERS
    //////////////////////////////////////////////////*/

    modifier validateLien(Lien calldata lien, uint256 lienId) {
        if (!_validateLien(lien, lienId)) {
            revert InvalidLien();
        }

        _;
    }

    modifier lienIsCurrent(Lien calldata lien) {
        if (_lienIsDefaulted(lien)) {
            revert LienDefaulted();
        }

        _;
    }

    modifier onlyBorrower(Lien calldata lien) {
        if (msg.sender != lien.borrower) {
            revert OnlyBorrower();
        }

        _;
    }

    function _validateLien(
        Lien calldata lien,
        uint256 lienId
    ) internal view returns (bool) {
        return liens[lienId] == keccak256(abi.encode(lien));
    }

    function _lienIsDefaulted(
        Lien calldata lien
    ) internal view returns (bool) {
        return (lien.startTime + lien.duration + lien.gracePeriod) < block.timestamp;
    }
}
