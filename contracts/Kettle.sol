// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { LoanOffer, BorrowOffer, Lien, LienState, LienStatus, MarketOffer, Side, PaymentDeadline } from "./Structs.sol";
import { InvalidLien, LienDefaulted, LienIsCurrent, Unauthorized, MakerIsNotBorrower, InsufficientAskAmount, OnlyBorrower, OfferNotAsk, OfferNotBid, BidNotWithLoan, CollectionMismatch, CurrencyMismatch, SizeMismatch, BidCannotBorrow, BidRequiresLoan, InvalidCriteria, InvalidMarketOfferAmount, RepayOnLastInstallment } from "./Errors.sol";

import { IKettle } from "./interfaces/IKettle.sol";
import { OfferController } from "./OfferController.sol";
import { StatusViewer } from "./StatusViewer.sol";
import { CollateralVerifier } from "./CollateralVerifier.sol";
import { OfferMatcher } from "./OfferMatcher.sol";

import { FixedInterest } from "./models/FixedInterest.sol";
import { Distributions } from "./lib/Distributions.sol";
import { Transfer } from "./lib/Transfer.sol";

import { ILenderReceipt } from "./LenderReceipt.sol";

/**
 * @title Kettle Lending and Marketplace Contract
 * @author diamondjim.eth
 * @notice Provides lending and marketplace functionality for ERC721 and ERC1155
 */
contract Kettle is IKettle, OfferController, StatusViewer, CollateralVerifier, OfferMatcher {
    ILenderReceipt public immutable lenderReceipt;

    uint256 private _nextLienId;
    mapping(uint256 => bytes32) public liens;

    constructor(address _lenderReceiptAddress) OfferController() public {
        lenderReceipt = ILenderReceipt(_lenderReceiptAddress);
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

        Transfer.transferToken(offer.collateral.collection, msg.sender, address(this), tokenId, offer.collateral.size);
        Transfer.transferCurrency(offer.terms.currency, offer.lender, borrower, amount);
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
            tokenId,
            offer.collateral.size,
            amount,
            offer.terms.rate,
            offer.terms.defaultRate,
            offer.fee.rate,
            offer.terms.period,
            offer.terms.gracePeriod,
            offer.terms.installments,
            block.timestamp,
            LienState({
                installment: 0,
                principal: amount
            })
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        _takeLoanOffer(lienId, offer, lien, signature);

        // mint lender receipt
        lenderReceipt.mint(offer.lender, lienId);

        emit Borrow(
            lienId,
            offer.lender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.defaultRate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.installments,
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

        Transfer.transferToken(offer.collateral.collection, offer.borrower, address(this), offer.collateral.identifier, offer.collateral.size);
        Transfer.transferCurrency(offer.terms.currency, msg.sender, offer.borrower, offer.terms.amount);
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
            offer.collateral.identifier,
            offer.collateral.size,
            offer.terms.amount,
            offer.terms.rate,
            offer.terms.defaultRate,
            offer.fee.rate,
            offer.terms.period,
            offer.terms.gracePeriod,
            offer.terms.installments,
            block.timestamp,
            LienState({
                installment: 0,
                principal: offer.terms.amount
            })
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        _takeBorrowOffer(lienId, offer, lien, signature);

        // mint lender receipt
        lenderReceipt.mint(msg.sender, lienId);

        emit Borrow(
            lienId,
            msg.sender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.defaultRate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.installments,
            lien.startTime
        );
    }

    /*//////////////////////////////////////////////////
                    PAYMENT FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Allows the borrower to make a principal payment towards an existing loan.
     * @param lienId The identifier of the lien representing the loan.
     * @param _principal The amount of principal to be paid.
     * @param lien The details of the loan (calldata).
     */
    function principalPayment(
        uint256 lienId,
        uint256 _principal,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
       (uint256 principal, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = _payment(lien, lienId, _principal, false);

        address lender = lenderReceipt.ownerOf(lienId);
        Transfer.transferCurrency(lien.currency, msg.sender, lender, pastInterest + currentInterest + principal);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);
    }

    /**
     * @notice Allows the borrower to make an interest payment towards an existing loan.
     * @param lienId The identifier of the lien representing the loan.
     * @param lien The details of the loan (calldata).
     */
    function interestPayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = _payment(lien, lienId, 0, false);

        address lender = lenderReceipt.ownerOf(lienId);
        Transfer.transferCurrency(lien.currency, msg.sender, lender, pastInterest + currentInterest);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);
    }

    /**
     * @notice Allows the borrower to make a cure payment towards an existing loan to cure a default.
     * @param lienId The identifier of the lien representing the loan.
     * @param lien The details of the loan (calldata).
     */
    function curePayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (, uint256 pastInterest, uint256 pastFee,,) = _payment(lien, lienId, 0, true);

        address lender = lenderReceipt.ownerOf(lienId);
        Transfer.transferCurrency(lien.currency, msg.sender, lender, pastInterest);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee);
    }

    /**
     * @dev Internal function to process a payment for an existing loan, including principal, interest, and fees.
     * @param lien The details of the loan (calldata).
     * @param lienId The identifier of the lien representing the loan.
     * @param _principal The amount of principal to be paid.
     * @param cureOnly A flag indicating whether the payment is a cure payment only (boolean).
     * @return principal The paid principal amount.
     * @return pastInterest The accrued interest from previous installments.
     * @return pastFee The accrued fee from previous installments.
     * @return currentInterest The interest for the current installment.
     * @return currentFee The fee for the current installment.
     */
    function _payment(
        Lien calldata lien,
        uint256 lienId,
        uint256 _principal,
        bool cureOnly
    ) internal returns (
        uint256 principal,
        uint256 pastInterest, 
        uint256 pastFee, 
        uint256 currentInterest,
        uint256 currentFee
    ) {
        // check if this the last installment to prevent repayment on the last installment
        if ((lien.state.installment + 1) == lien.installments) {
            revert RepayOnLastInstallment();
        }

        // calculate accrued interest and fees from previous and current installments
        (,, pastInterest, pastFee, currentInterest, currentFee) = payments(lien);

        // calculate minimum interest amount to be paid
        uint256 minimumPayment = pastInterest + pastFee;
        if (!cureOnly) {
            minimumPayment += currentInterest + currentFee;
        }

        // determine the actual principal to be paid, considering the requested amount and remaining principal
        uint256 principal = Math.min(_principal, lien.state.principal);
        uint256 updatedPrincipal = lien.state.principal - principal;

        // update lien state
        Lien memory newLien = Lien(
            lien.recipient,
            lien.borrower,
            lien.currency,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.defaultRate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.installments,
            lien.startTime,
            LienState({
                installment: FixedInterest.computeNextInstallment(
                    lien.startTime,
                    lien.period,
                    cureOnly, 
                    lien.state.installment
                ),
                principal: updatedPrincipal
            })
        );

        liens[lienId] = keccak256(abi.encode(newLien));

        emit Payment(
            lienId,
            lien.state.installment,
            principal,
            pastInterest,
            pastFee,
            cureOnly ? 0 : currentInterest,
            cureOnly ? 0 : currentFee,
            newLien.state.principal,
            newLien.state.installment
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
        (uint256 balance, uint256 principal, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = payments(lien);
        
        address lender = lenderReceipt.ownerOf(oldLienId);

        // distribute loan payments from new lender to old lender and pay or transfer net funds from borrower
        Distributions.distributeLoanPayments(
            lien.currency,
            amount,                 // distribute new principal
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lender,                 // original lender
            lien.recipient,         // original recipient
            offer.lender,           // primary payer
            msg.sender,             // pays any remaining amount
            msg.sender              // receives net principal
        );

        // burn the lender receipt for the old lien
        lenderReceipt.burn(oldLienId);
        delete liens[oldLienId];

        emit Refinance(
            oldLienId,
            newLienId,
            amount,
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
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
        (uint256 balance, uint256 principal, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = payments(lien);

        address lender = lenderReceipt.ownerOf(lienId);
        Transfer.transferToken(lien.collection, address(this), lien.borrower, lien.tokenId, lien.size);
        Transfer.transferCurrency(lien.currency, msg.sender, lender, principal + pastInterest + currentInterest);
        Transfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);

        // burn the lender receipt for the lien
        lenderReceipt.burn(lienId);
        delete liens[lienId];

        emit Repay(
            lienId,
            lien.state.installment,
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
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

        address lender = lenderReceipt.ownerOf(lienId);
        Transfer.transferToken(lien.collection, address(this), lender, lien.tokenId, lien.size);

        // burn lender receipt
        lenderReceipt.burn(lienId);
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
        _takeMarketOffer(offer, signature);
        
        if (offer.side == Side.BID) {
            if (offer.terms.withLoan) revert BidRequiresLoan();

            // pay market fees (bidder pays fees)
            netAmount = _payMarketFees(offer.terms.currency, offer.maker, offer.fee.recipient, offer.terms.amount, offer.fee.rate);

            Transfer.transferToken(offer.collateral.collection, msg.sender, offer.maker, tokenId, offer.collateral.size);
            Transfer.transferCurrency(offer.terms.currency, offer.maker, msg.sender, netAmount);

        } else {
            // pay market fees (buyer pays fees)
            netAmount = _payMarketFees(offer.terms.currency, msg.sender, offer.fee.recipient, offer.terms.amount, offer.fee.rate);

            Transfer.transferToken(offer.collateral.collection, offer.maker, msg.sender, tokenId, offer.collateral.size);
            Transfer.transferCurrency(offer.terms.currency, msg.sender, offer.maker, netAmount);
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
        _takeMarketOffer(askOffer, askOfferSignature);

        // start a lien (borrow min of requested amount and ask offer amount)
        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);
        lienId = _borrow(loanOffer, _borrowAmount, tokenId, msg.sender, loanOfferSignature);

        // transfer loan principal from lender and rest of amount from buyer to seller
        Transfer.transferCurrency(loanOffer.terms.currency, loanOffer.lender, askOffer.maker, _borrowAmount);
        Transfer.transferCurrency(askOffer.terms.currency, msg.sender, askOffer.maker, askOffer.terms.amount - _borrowAmount);

        // retrieve fees from seller
        uint256 netAmount = _payMarketFees(askOffer.terms.currency, askOffer.maker, askOffer.fee.recipient, askOffer.terms.amount, askOffer.fee.rate);

        // lock collateral
        Transfer.transferToken(loanOffer.collateral.collection, askOffer.maker, address(this), tokenId, loanOffer.collateral.size);

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
        _takeMarketOffer(bidOffer, bidOfferSignature);

        // start loan (borrow amount specified in bid)
        lienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, tokenId, bidOffer.maker, loanOfferSignature);

        // transfer loan principal from lender and rest of amount from bidder to seller
        Transfer.transferCurrency(loanOffer.terms.currency, loanOffer.lender, msg.sender, bidOffer.terms.borrowAmount);
        Transfer.transferCurrency(bidOffer.terms.currency, bidOffer.maker, msg.sender, bidOffer.terms.amount - bidOffer.terms.borrowAmount);

        // retrieve fees from seller
        uint256 netAmount = _payMarketFees(bidOffer.terms.currency, msg.sender, bidOffer.fee.recipient, bidOffer.terms.amount, bidOffer.fee.rate);

        // lock collateral
        Transfer.transferToken(loanOffer.collateral.collection, msg.sender, address(this), tokenId, loanOffer.collateral.size);

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
        _takeMarketOffer(askOffer, askOfferSignature);

        // pay market fees (buyer pays fees)
        uint256 netAmount = _payMarketFees(askOffer.terms.currency, msg.sender, askOffer.fee.recipient, askOffer.terms.amount, askOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 balance, uint256 principal, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = payments(lien);

        // net ask amount must be greater than amount owed
        if (netAmount < balance) {
            revert InsufficientAskAmount();
        }

        address lender = lenderReceipt.ownerOf(lienId);
        Distributions.distributeLoanPayments(
            lien.currency, 
            netAmount,                  // distribute net ask amount
            balance, 
            principal,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee, 
            lender, 
            lien.recipient, 
            msg.sender,                 // buyer pays primary amount
            msg.sender,                 // buyer pays residual amount
            askOffer.maker              // seller receives net principal
        );

        // transfer collateral from this to buyer
        Transfer.transferToken(lien.collection, address(this), msg.sender, lien.tokenId, lien.size);

        // burn the lender receipt for the lien
        lenderReceipt.burn(lienId);
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
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
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
        _takeMarketOffer(bidOffer, bidOfferSignature);

        // pay market fees (bidder pays fees)
        uint256 netAmount = _payMarketFees(bidOffer.terms.currency, bidOffer.maker, bidOffer.fee.recipient, bidOffer.terms.amount, bidOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 balance, uint256 principal, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = payments(lien);
        
        address lender = lenderReceipt.ownerOf(lienId);
        Distributions.distributeLoanPayments(
            lien.currency,
            netAmount,                      // distribute net bid amount
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lender,
            lien.recipient,
            bidOffer.maker,                 // bidder pays primary amount
            msg.sender,                     // seller pays residual amount
            msg.sender                      // seller receives net principal
        );
        
        // transfer collateral from this to buyer
        Transfer.transferToken(lien.collection, address(this), bidOffer.maker, lien.tokenId, lien.size);

        // burn the lender receipt for the lien
        lenderReceipt.burn(lienId);
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
            balance, 
            principal, 
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
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

        _takeMarketOffer(askOffer, askOfferSignature);

        // start new loan
        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);
        newLienId = _borrow(loanOffer, _borrowAmount, lien.tokenId, msg.sender, loanOfferSignature);

        // transfer loan principal from lender and rest of amount from buyer to the contract
        Transfer.transferCurrency(lien.currency, loanOffer.lender, address(this), _borrowAmount);
        Transfer.transferCurrency(lien.currency, msg.sender, address(this), askOffer.terms.amount - _borrowAmount);

        // pay market fees (from this contract)
        uint256 netAmount = _payMarketFees(lien.currency, address(this), askOffer.fee.recipient, askOffer.terms.amount, askOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 balance, uint256 principal, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = payments(lien);

        // net amount payable to lien must be greater than balance
        if (netAmount < balance) {
            revert InsufficientAskAmount();
        }

        // transfer net principal to seller and pay balance and fees
        address lender = lenderReceipt.ownerOf(lienId);
        uint256 netPrincipal = netAmount - balance;
        Transfer.transferCurrency(lien.currency, address(this), askOffer.maker, netPrincipal);
        Transfer.transferCurrency(lien.currency, address(this), lender, principal + currentInterest + pastInterest);
        Transfer.transferCurrency(lien.currency, address(this), lien.recipient, pastFee + currentFee);

        // burn the lender receipt
        lenderReceipt.burn(lienId);
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
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
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

        _takeMarketOffer(bidOffer, bidOfferSignature);

        // borrow from loan offer
        newLienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, lien.tokenId, bidOffer.maker, loanOfferSignature);

        // transfer loan principal and rest of bid to this
        Transfer.transferCurrency(lien.currency, loanOffer.lender, address(this), bidOffer.terms.borrowAmount);
        Transfer.transferCurrency(lien.currency, bidOffer.maker, address(this), bidOffer.terms.amount - bidOffer.terms.borrowAmount);

        // pay market fees (from this contract)
        uint256 netAmount = _payMarketFees(bidOffer.terms.currency, address(this), bidOffer.fee.recipient, bidOffer.terms.amount, bidOffer.fee.rate);

        // retrieve payment details from the lien
        (uint256 balance, uint256 principal, uint256 pastInterest, uint256 pastFee, uint256 currentInterest, uint256 currentFee) = payments(lien);

        address lender = lenderReceipt.ownerOf(lienId);
        Distributions.distributeLoanPayments(
            lien.currency,
            netAmount,                  // distribute net amount bid amount
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lender,
            lien.recipient,
            address(this),              // this is the primary payer
            msg.sender,                 // seller pays residual amount
            msg.sender                  // seller receives net principal
        );

        // burn the lender receipt
        lenderReceipt.burn(lienId);
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
            balance,
            principal, 
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
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

        Transfer.transferCurrency(currency, payer, recipient, feeAmount);
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
        uint256 paidThrough = lien.startTime + (lien.state.installment * lien.period);
        return (paidThrough + lien.period + lien.gracePeriod) < block.timestamp;
    }
}
